import Link from "next/link";

import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { SafeStateBody } from "@/components/unavailable-view";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";

export const StaffAccessDenied = () => (
  <PageFrame variant="task">
    <SafeStateBody
      description="目前無法使用這個管理工作區。"
      icon="shield"
      title="你沒有帳戶管理權限"
    >
      <Button
        className="w-full sm:w-auto"
        nativeButton={false}
        render={<Link href="/" prefetch={false} />}
        role="link"
      >
        返回個人主頁
      </Button>
      <Button
        className="w-full sm:w-auto"
        nativeButton={false}
        render={<Link href="/status" prefetch={false} />}
        role="link"
        variant="secondary"
      >
        查看帳戶狀態
      </Button>
    </SafeStateBody>
    <RestoredPageRevalidator />
  </PageFrame>
);
