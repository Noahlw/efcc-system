import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DepartmentDutyPager } from "../../src/features/roles/ui/department-duty-pager";
import type { RolePersonDutyGroup } from "../../src/features/roles/ui/role-person-api";

const group = (
  departmentId: string,
  departmentName: string,
  programs: RolePersonDutyGroup["programs"] = []
): RolePersonDutyGroup => ({
  departmentId,
  departmentName,
  hasNextProgramsPage: false,
  manager: null,
  programs,
  programsPage: 1,
});

const render = (groups: RolePersonDutyGroup[], groupCount: number | null) =>
  renderToStaticMarkup(
    <DepartmentDutyPager
      busy={false}
      groupCount={groupCount}
      groups={groups}
      hasNextPage={(groupCount ?? 0) > 2}
      onPageChange={() => null}
      onProgramPageChange={() => null}
      page={1}
      pageSize={2}
      status="complete"
    />
  );

describe("DepartmentDutyPager", () => {
  it("renders one department pair with quiet accessible paging and no visible fraction", () => {
    const markup = render(
      [
        group("dept-a", "敬拜部"),
        group("dept-b", "青年部", [
          {
            assignmentId: "assignment-1",
            createdAt: 1,
            programId: "program-1",
            programName: "週六青年團契",
          },
        ]),
        group("dept-c", "關顧部"),
        group("dept-d", "宣教部"),
        group("dept-e", "教育部"),
        group("dept-f", "兒童部"),
      ],
      6
    );

    expect(markup).toContain("敬拜部");
    expect(markup).toContain("青年部");
    expect(markup).toContain("週六青年團契");
    expect(markup).toContain("聚會負責人");
    expect(markup).toContain('aria-label="上一組部門"');
    expect(markup).toContain('aria-label="下一組部門"');
    expect(markup).toContain('aria-label="部門第 2 組"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("部門第 1 組，共 3 組");
    expect(markup).not.toMatch(/\b1\s*[/／]\s*3\b/u);
    expect(markup).not.toContain(">王<");
  });

  it("keeps a single odd group stable without inventing a dummy pair", () => {
    const markup = render([group("dept-only", "兒童部")], 1);

    expect(markup).toContain("兒童部");
    expect(markup).not.toContain("部門第 2 組");
    expect(markup).toContain("部門第 1 組，共 1 組");
  });

  it("keeps source continuation distinct from the current pair position", () => {
    const markup = renderToStaticMarkup(
      <DepartmentDutyPager
        busy={false}
        groupCount={null}
        groups={[group("dept-a", "宣教部")]}
        hasNextPage
        onProgramPageChange={() => null}
        onPageChange={() => null}
        page={1}
        pageSize={2}
        status="partial"
      />
    );

    expect(markup).toContain("宣教部");
    expect(markup).toContain("部門第 1 組");
    expect(markup).toContain("部門職務分批顯示");
  });
});
