import type { ReactNode } from "react";

import { PageFrame } from "@/components/page-frame";

export default function TaskLayout({ children }: { children: ReactNode }) {
  return <PageFrame variant="task">{children}</PageFrame>;
}
