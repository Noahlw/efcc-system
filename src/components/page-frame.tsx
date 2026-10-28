import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

const frameClasses = cva("", {
  variants: {
    variant: {
      auth: "auth-page-frame bg-background mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center px-[var(--screen-gutter)] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]",
      task: "bg-surface mx-auto flex min-h-dvh w-full max-w-[40rem] flex-col px-[var(--screen-gutter)] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]",
    },
  },
});

export type PageFrameVariant = NonNullable<
  VariantProps<typeof frameClasses>["variant"]
>;

export const PageFrame = ({
  children,
  navigation,
  variant,
}: {
  children: ReactNode;
  navigation?: ReactNode;
  variant: PageFrameVariant;
}) => {
  if (variant === "task" && navigation) {
    return (
      <div className="bg-surface min-h-dvh lg:flex lg:h-dvh lg:min-h-0 lg:overflow-hidden lg:pl-[var(--sidebar-width)]">
        <div className="hidden lg:block">{navigation}</div>
        <div
          data-page-scroll=""
          className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-8 lg:pt-8 lg:pb-12"
        >
          <div
            className={frameClasses({
              className: "lg:min-h-0 lg:px-0 lg:pt-0 lg:pb-0",
              variant: "task",
            })}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
  return <div className={frameClasses({ variant })}>{children}</div>;
};

export const ChurchBrand = () => (
  <header className="mb-6">
    <p className="text-primary text-task font-extrabold tracking-[0.1em]">
      顯恩堂
    </p>
    <p className="text-meta text-muted-foreground mt-1">
      中國基督教播道會顯恩堂
    </p>
  </header>
);

export const TaskHeader = ({
  children,
  className = "mb-6",
  returnControl,
  singleRow = false,
  title,
}: {
  title: string;
  className?: string;
  returnControl?: ReactNode;
  singleRow?: boolean;
  children?: ReactNode;
}) => (
  <header
    className={`flex min-h-14 items-center gap-3 ${singleRow ? "flex-nowrap" : "flex-wrap"} ${className}`}
  >
    {returnControl}
    <h1
      className={`text-task min-w-0 flex-1 ${singleRow ? "wrap-anywhere" : ""}`}
    >
      {title}
    </h1>
    {children}
  </header>
);

/** Pending content only; the caller retains authorization and frame ownership. */
export const PageLoading = ({ title }: { title: string }) => (
  <main aria-busy="true" className="mx-auto w-full">
    <h1 className="text-root">{title}</h1>
    <p className="text-muted-foreground mt-4" role="status">
      正在載入，請稍候。
    </p>
    <div aria-hidden="true" className="mt-6 flex flex-col gap-4">
      <div className="bg-muted h-5 w-2/3 rounded-md" />
      <div className="bg-muted h-24 rounded-lg" />
      <div className="bg-muted h-5 w-1/2 rounded-md" />
    </div>
  </main>
);

export const RootFrame = ({
  children,
  navigation,
  showMobileNavigation = true,
}: {
  children: ReactNode;
  navigation: ReactNode;
  showMobileNavigation?: boolean;
}) => (
  <div className="bg-surface flex h-dvh min-h-0 flex-col overflow-hidden lg:pl-[var(--sidebar-width)]">
    <div
      className={`order-1 shrink-0 ${
        showMobileNavigation ? "" : "hidden lg:block"
      }`}
    >
      {navigation}
    </div>
    <div
      data-page-scroll=""
      className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-[var(--screen-gutter)] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 lg:pb-12"
    >
      <div className="mx-auto w-full max-w-[72rem] [&>main]:flex-none">
        {children}
      </div>
    </div>
  </div>
);
