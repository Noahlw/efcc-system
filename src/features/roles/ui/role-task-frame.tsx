"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { RootFrame, TaskHeader } from "@/components/page-frame";

export const RoleTaskFrame = ({
  actions,
  children,
  navigation,
  returnControl,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  navigation: ReactNode;
  returnControl: ReactNode;
  title: string;
}) => {
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const scroller = content?.closest<HTMLElement>("[data-page-scroll]");
    if (!content || !scroller) {
      return;
    }
    let pendingFrame: number | null = null;
    const revealFocusedControl = () => {
      pendingFrame = null;
      if (window.visualViewport && window.visualViewport.scale !== 1) {
        return;
      }
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !scroller.contains(focused)) {
        return;
      }
      const visible = scroller.getBoundingClientRect();
      const control = focused.getBoundingClientRect();
      if (control.height > visible.height) {
        scroller.scrollTop += control.top - visible.top;
        return;
      }
      if (control.bottom > visible.bottom) {
        scroller.scrollTop += control.bottom - visible.bottom;
      } else if (control.top < visible.top) {
        scroller.scrollTop += control.top - visible.top;
      }
    };
    const scheduleReveal = () => {
      if (pendingFrame === null) {
        pendingFrame = window.requestAnimationFrame(revealFocusedControl);
      }
    };
    // Native focus does not re-scroll an already focused control after text,
    // footer or viewport reflow. Adjust only the existing page scroll owner.
    const observer = new ResizeObserver(scheduleReveal);
    observer.observe(content);
    observer.observe(scroller);
    scroller.addEventListener("focusin", scheduleReveal);
    scheduleReveal();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("focusin", scheduleReveal);
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    // These S3-only inherited values also reach the Security dialog's portal.
    const root = document.documentElement.style;
    const heightProperty = "--s3-task-viewport-height";
    const offsetProperty = "--s3-task-viewport-offset-top";
    const previousHeight = root.getPropertyValue(heightProperty);
    const previousOffset = root.getPropertyValue(offsetProperty);
    const restoreViewport = () => {
      root.setProperty(heightProperty, previousHeight);
      root.setProperty(offsetProperty, previousOffset);
    };
    const updateViewport = () => {
      // Pinch zoom retains native layout, scrolling and magnification.
      if (viewport.scale !== 1) {
        restoreViewport();
        return;
      }
      root.setProperty(heightProperty, `${viewport.height}px`);
      root.setProperty(offsetProperty, `${viewport.offsetTop}px`);
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      restoreViewport();
    };
  }, []);

  return (
    <RootFrame
      actions={
        actions ? (
          <footer
            aria-label="任務操作"
            className="border-border bg-surface border-t px-[var(--screen-gutter)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-8"
          >
            <div className="mx-auto flex w-full max-w-[40rem] flex-wrap items-center justify-end gap-3">
              {actions}
            </div>
          </footer>
        ) : null
      }
      navigation={navigation}
      showMobileNavigation={false}
      style={{
        height: "var(--s3-task-viewport-height, 100dvh)",
        marginTop: "var(--s3-task-viewport-offset-top, 0px)",
      }}
    >
      <main className="mx-auto w-full max-w-[40rem]" ref={contentRef}>
        <TaskHeader singleRow returnControl={returnControl} title={title} />
        {children}
      </main>
    </RootFrame>
  );
};
