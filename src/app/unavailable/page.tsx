import { UnavailableView } from "@/components/unavailable-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "暫時未能載入資料 · 顯恩堂系統",
};

interface UnavailablePageProps {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}

export default async function UnavailablePage({
  searchParams,
}: UnavailablePageProps) {
  const { returnTo } = await searchParams;
  // Only delivered protected pages may be retried; never follow an arbitrary URL.
  const retryHref = returnTo === "/status" ? "/status" : "/";
  return <UnavailableView retryHref={retryHref} />;
}
