import { Frame } from "@/components/frame";

export default function WarehouseLayout({ children }: LayoutProps<"/bodega">) {
  return <Frame app="warehouse">{children}</Frame>;
}
