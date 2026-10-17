import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Eye,
  FileText,
  House,
  KeyRound,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserRound,
  UsersRound,
} from "lucide-react";

// Lucide owns runtime paths; each product glyph matches its retained R11 Book asset.
const icons = {
  "arrow-left": ArrowLeft,
  calendar: CalendarDays,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  eye: Eye,
  "file-text": FileText,
  house: House,
  "key-round": KeyRound,
  "log-out": LogOut,
  mail: Mail,
  plus: Plus,
  "refresh-cw": RefreshCw,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  smartphone: Smartphone,
  user: UserRound,
  users: UsersRound,
};

type IconName = keyof typeof icons;

export const Icon = ({
  className,
  name,
}: {
  name: IconName;
  className?: string;
}) => {
  const Glyph = icons[name];

  return (
    <Glyph
      aria-hidden="true"
      className={`r11-icon ${className ?? ""}`}
      fill="none"
      focusable="false"
      height={24}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      viewBox="0 0 24 24"
      width={24}
    />
  );
};
