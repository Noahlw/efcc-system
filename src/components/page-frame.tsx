import type { ReactNode } from "react";

export type PageFrameVariant = "auth" | "task";

const frameClasses: Record<PageFrameVariant, string> = {
  auth: "mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center px-5 py-8",
  task: "mx-auto min-h-dvh w-full max-w-[40rem] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-8",
};

export const PageFrame = ({
  children,
  variant,
}: {
  children: ReactNode;
  variant: PageFrameVariant;
}) => <div className={frameClasses[variant]}>{children}</div>;

export const RootFrame = ({
  children,
  navigation,
}: {
  children: ReactNode;
  navigation: ReactNode;
}) => (
  <div className="min-h-dvh lg:pl-64">
    {navigation}
    <div className="mx-auto w-full max-w-6xl px-5 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-8 lg:py-10 lg:pb-10">
      {children}
    </div>
  </div>
);
