export const staffAccountIdentifier = ({
  userId,
  username,
}: {
  userId: string;
  username: string | null;
}) => username ?? `未設定 Username · 帳戶編號：${userId}`;
