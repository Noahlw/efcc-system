import { isBuiltin } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

interface Violation {
  reason: string;
  trace: string[];
}

const onlyTypeSpecifiers = (node: ts.Node | undefined): boolean => {
  if (!node || (!ts.isNamedImports(node) && !ts.isNamedExports(node))) {
    return false;
  }
  return (
    node.elements.length > 0 && node.elements.every((item) => item.isTypeOnly)
  );
};

const isRuntimeImportCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require"));

const runtimeImports = (
  source: ts.SourceFile
): ((ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) | null)[] => {
  const imports: (
    | (ts.StringLiteral | ts.NoSubstitutionTemplateLiteral)
    | null
  )[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (
        clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        (!clause?.name && onlyTypeSpecifiers(clause?.namedBindings))
      ) {
        return;
      }
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly || onlyTypeSpecifiers(node.exportClause)) {
        return;
      }
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier);
      }
      return;
    }
    if (isRuntimeImportCall(node)) {
      const [argument] = node.arguments;
      imports.push(
        argument &&
          (ts.isStringLiteral(argument) ||
            ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument
          : null
      );
    }
    node.forEachChild(visit);
  };
  visit(source);
  return imports;
};

const isClientRoot = (source: ts.SourceFile): boolean => {
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") {
      return true;
    }
  }
  return false;
};

/** Bounded local-source check; package internals remain the real build's domain. */
export const inspectRuntimeBoundaries = (directory: string) => {
  const root = path.resolve(directory);
  const api = new API({ cwd: root });
  try {
    const configPath = path.join(root, "tsconfig.json");
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    try {
      const project = snapshot.getProject(configPath);
      if (!project) {
        throw new Error("TypeScript did not load the boundary project");
      }
      const sourceRoot = path.join(root, "src") + path.sep;
      const files = project.program
        .getSourceFileNames()
        .filter(
          (file) => file.startsWith(sourceRoot) && !file.endsWith(".d.ts")
        )
        .toSorted();
      const source = (file: string): ts.SourceFile => {
        const result = project.program.getSourceFile(file);
        if (!result) {
          throw new Error(`Runtime boundary source disappeared: ${file}`);
        }
        return result;
      };
      const relative = (file: string) =>
        path.relative(root, file).split(path.sep).join("/");
      const clientFiles = files.filter((file) => isClientRoot(source(file)));
      const violations: Violation[] = [];
      const cycles = new Set<string>();
      const edges = new Set<string>();

      for (const client of clientFiles) {
        const visited = new Set<string>();
        const walk = (file: string, trace: string[]): void => {
          if (trace.includes(file)) {
            cycles.add(
              [...trace.slice(trace.indexOf(file)), file]
                .map(relative)
                .join(" → ")
            );
            return;
          }
          if (visited.has(file)) {
            return;
          }
          visited.add(file);
          const nextTrace = [...trace, file];
          for (const literal of runtimeImports(source(file))) {
            if (literal === null) {
              violations.push({
                reason: "non-literal runtime import",
                trace: nextTrace.map(relative),
              });
              continue;
            }
            const specifier = literal.text;
            if (
              isBuiltin(specifier) ||
              specifier.startsWith("cloudflare:") ||
              specifier === "server-only"
            ) {
              violations.push({
                reason: "server platform",
                trace: [...nextTrace.map(relative), specifier],
              });
              continue;
            }
            const resolved =
              project.checker.getSymbolAtLocation(literal)?.declarations[0]
                ?.path;
            if (!resolved) {
              if (specifier.startsWith(".") || specifier.startsWith("@/")) {
                violations.push({
                  reason: "unresolved local runtime import",
                  trace: [...nextTrace.map(relative), specifier],
                });
              }
              continue;
            }
            if (
              !resolved.startsWith(sourceRoot) ||
              resolved.endsWith(".d.ts")
            ) {
              continue;
            }
            edges.add(`${relative(file)} → ${relative(resolved)}`);
            if (relative(resolved).startsWith("src/server/")) {
              violations.push({
                reason: "server runtime",
                trace: [...nextTrace, resolved].map(relative),
              });
              continue;
            }
            walk(resolved, nextTrace);
          }
        };
        walk(client, []);
      }
      return {
        clientRoots: clientFiles.map(relative),
        cycles: [...cycles].toSorted(),
        runtimeEdges: edges.size,
        serverOwners: files
          .filter((file) => relative(file).startsWith("src/server/"))
          .map(relative),
        sourceFiles: files.map(relative),
        violations,
      };
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
};

export const assertRuntimeBoundaries = (root: string): void => {
  const result = inspectRuntimeBoundaries(root);
  if (result.violations.length > 0) {
    throw new Error(
      result.violations
        .map(
          (item) =>
            `Forbidden client dependency (${item.reason}): ${item.trace.join(" → ")}`
        )
        .join("\n")
    );
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = inspectRuntimeBoundaries(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.violations.length > 0 ? 1 : 0;
}
