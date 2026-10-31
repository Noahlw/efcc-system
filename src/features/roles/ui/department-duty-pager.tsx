"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import type { RolePersonDutyGroup } from "./role-person-api";

export const DepartmentDutyPager = ({
  action,
  busy,
  groupCount,
  groups,
  hasNextPage,
  onPageChange,
  onProgramPageChange,
  page,
  pageSize,
  status,
}: {
  action?: React.ReactNode;
  busy: boolean;
  groupCount: number | null;
  groups: RolePersonDutyGroup[];
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
  onProgramPageChange: (departmentId: string, page: number) => void;
  page: number;
  pageSize: number;
  status: "complete" | "partial";
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const pairRef = useRef(0);
  const [pair, setPair] = useState(0);
  const pairCount = Math.ceil(groups.length / 2);

  useEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (node.clientWidth > 0) {
        node.scrollLeft = pairRef.current * node.clientWidth;
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const goToPair = (next: number) => {
    const node = scroller.current;
    if (!node || busy || next < 0 || next >= pairCount) {
      return;
    }
    node.scrollTo({ left: next * node.clientWidth });
  };

  return (
    <section aria-labelledby="person-duties-heading" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-section" id="person-duties-heading">
          部門與聚會職務
        </h3>
        {action}
      </div>
      {groups.length ? (
        <div
          aria-label="部門職務內容"
          className="mt-3 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain focus-visible:outline-2"
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }
            if (event.key === "ArrowRight" && pair + 1 < pairCount) {
              event.preventDefault();
              goToPair(pair + 1);
            } else if (event.key === "ArrowLeft" && pair > 0) {
              event.preventDefault();
              goToPair(pair - 1);
            }
          }}
          onScroll={(event) => {
            const node = event.currentTarget;
            if (node.clientWidth === 0) {
              return;
            }
            const next = Math.min(
              pairCount - 1,
              Math.round(node.scrollLeft / node.clientWidth)
            );
            pairRef.current = next;
            setPair(next);
          }}
          ref={scroller}
          role="region"
          tabIndex={0}
        >
          {Array.from({ length: pairCount }, (_, index) => (
            <ul
              className="grid w-full shrink-0 snap-start gap-6 md:grid-cols-2"
              key={groups[index * 2]?.departmentId}
            >
              {groups.slice(index * 2, index * 2 + 2).map((group) => (
                <li className="min-w-0" key={group.departmentId}>
                  <h4 className="text-label font-[650] wrap-anywhere">
                    {group.departmentName}
                  </h4>
                  <dl className="border-border mt-2 flex flex-col gap-2 border-l pl-3">
                    {group.manager ? (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <dt className="text-meta text-muted-foreground">
                          部門主管
                        </dt>
                        <dd className="text-meta">現任</dd>
                      </div>
                    ) : null}
                    {group.programs.map((program) => (
                      <div
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                        key={program.assignmentId}
                      >
                        <dt className="text-meta min-w-0 wrap-anywhere">
                          {program.programName}
                        </dt>
                        <dd className="text-meta text-muted-foreground shrink-0">
                          聚會負責人
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {group.programsPage > 1 || group.hasNextProgramsPage ? (
                    <div
                      aria-label={`${group.departmentName}聚會分頁`}
                      className="mt-2 flex flex-wrap items-center gap-2"
                      role="group"
                    >
                      <Button
                        disabled={busy || group.programsPage <= 1}
                        onClick={() =>
                          onProgramPageChange(
                            group.departmentId,
                            group.programsPage - 1
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        上一頁聚會
                      </Button>
                      <span className="text-meta" role="status">
                        第 {group.programsPage} 頁，聚會職務分頁顯示
                      </span>
                      <Button
                        disabled={busy || !group.hasNextProgramsPage}
                        onClick={() =>
                          onProgramPageChange(
                            group.departmentId,
                            group.programsPage + 1
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        下一頁聚會
                      </Button>
                    </div>
                  ) : null}
                  {!group.manager && group.programs.length === 0 ? (
                    <p
                      className="text-meta text-muted-foreground mt-2"
                      role="status"
                    >
                      此頁沒有已載入的職務，請返回上一頁或重試。
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground py-6" role="status">
          {status === "partial" || page > 1
            ? "此頁未能確認職務，請返回上一頁或重試。"
            : "此人士目前沒有部門或聚會職務。"}
        </p>
      )}
      <span aria-live="polite" className="sr-only">
        部門第 {pair + 1} 組，共 {Math.max(pairCount, 1)} 組
      </span>
      {pairCount > 1 ? (
        <div
          aria-label="部門職務分組"
          className="flex items-center justify-between gap-1"
          role="group"
        >
          <Button
            aria-label="上一組部門"
            className="size-11 justify-center px-0"
            disabled={busy || pair === 0}
            onClick={() => goToPair(pair - 1)}
            type="button"
            variant="quiet"
          >
            <Icon className="size-5" name="chevron-left" />
          </Button>
          <div className="flex items-center">
            {Array.from({ length: pairCount }, (_, index) => (
              <button
                aria-current={index === pair ? "true" : undefined}
                aria-label={`部門第 ${index + 1} 組`}
                className="flex size-11 items-center justify-center rounded-full focus-visible:outline-2"
                disabled={busy}
                key={groups[index * 2]?.departmentId}
                onClick={() => goToPair(index)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${index === pair ? "bg-primary" : "bg-border"}`}
                />
              </button>
            ))}
          </div>
          <Button
            aria-label="下一組部門"
            className="size-11 justify-center px-0"
            disabled={busy || pair + 1 >= pairCount}
            onClick={() => goToPair(pair + 1)}
            type="button"
            variant="quiet"
          >
            <Icon className="size-5" name="chevron-right" />
          </Button>
        </div>
      ) : null}
      {page > 1 || hasNextPage ? (
        <>
          <p className="text-meta text-muted-foreground mt-3">
            更多部門職務請翻頁查閱。
          </p>
          <div
            aria-label="更多部門職務"
            className="mt-2 flex flex-wrap items-center gap-2"
            role="group"
          >
            <Button
              disabled={busy || page <= 1}
              onClick={() => onPageChange(page - 1)}
              type="button"
              variant="secondary"
            >
              上一頁部門
            </Button>
            <span className="sr-only" role="status">
              {groupCount === null
                ? "部門職務分批顯示"
                : `部門職務第 ${page} 批，每批最多 ${pageSize} 個部門`}
            </span>
            <Button
              disabled={busy || !hasNextPage}
              onClick={() => onPageChange(page + 1)}
              type="button"
              variant="secondary"
            >
              下一頁部門
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
};
