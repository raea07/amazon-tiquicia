import { Frame } from "@/components/frame";

export default function RouteLayout({ children }: LayoutProps<"/ruta">) {
  return <Frame app="driver">{children}</Frame>;
}
