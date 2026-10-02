/**
 * Synthetic notice and department-scope fixtures. Publication/expiry windows
 * are relative to the current day so "published" and "expired" stay meaningful.
 */
const DAY_MS = 86_400_000;

export interface NoticeFixtures {
  notices: {
    id: string;
    title: string;
    body: string;
    scopeType: "church" | "department" | "program";
    scopeId?: string;
    publishedAt?: string;
    expiresAt?: string;
  }[];
  departmentMemberships: {
    id: string;
    departmentId: string;
    username: string;
  }[];
  departmentManagerAssignments: {
    id: string;
    departmentId: string;
    username: string;
  }[];
}

export const buildNoticeFixtures = (now: Date = new Date()): NoticeFixtures => {
  const at = (days: number): string =>
    new Date(now.getTime() + days * DAY_MS).toISOString();

  return {
    departmentManagerAssignments: [
      // Assigned manager of 敬拜部 without Department membership.
      {
        departmentId: "dept-worship",
        id: "mgr-worship-wong",
        username: "wong.tai.ming",
      },
    ],
    departmentMemberships: [
      // Department member without a manager assignment.
      {
        departmentId: "dept-worship",
        id: "mem-worship-chan",
        username: "Chan.Siu.Fong",
      },
    ],
    notices: [
      {
        body: "歡迎參加本主日崇拜，請提前十五分鐘到達。",
        id: "notice-church-welcome",
        publishedAt: at(-2),
        scopeType: "church",
        title: "教會週報",
      },
      {
        body: "敬拜部會議改於週六上午十時舉行。",
        id: "notice-worship-department",
        publishedAt: at(-1),
        scopeId: "dept-worship",
        scopeType: "department",
        title: "敬拜部消息",
      },
      {
        body: "關顧部探訪安排。",
        id: "notice-care-department",
        publishedAt: at(-1),
        scopeId: "dept-care",
        scopeType: "department",
        title: "關顧部消息",
      },
      {
        body: "本週主日崇拜講員為陳牧師。",
        id: "notice-sunday-program",
        publishedAt: at(-1),
        scopeId: "prog-sunday-service",
        scopeType: "program",
        title: "主日崇拜消息",
      },
      {
        body: "草稿不應顯示。",
        id: "notice-draft",
        scopeType: "church",
        title: "未發佈通告",
      },
      {
        body: "過期通告不應顯示。",
        expiresAt: at(-1),
        id: "notice-expired",
        publishedAt: at(-5),
        scopeType: "church",
        title: "已過期通告",
      },
    ],
  };
};
