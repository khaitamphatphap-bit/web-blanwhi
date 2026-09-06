import Link from "next/link";
import { ZaloPayRefundAdmin } from "./zalopay-refund-admin";

export const dynamic = "force-dynamic";

export default function ZaloPayRefundPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-white px-6 py-10 md:my-12 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <Link href="/admin/orders" className="text-xs uppercase text-neutral-500">BLANWHI ADMIN</Link>
          <h1 className="mt-3 text-3xl font-medium">Hoàn tiền giao dịch ZaloPay thất lạc</h1>
        </div>
        <Link href="/admin/orders" className="h-10 border border-neutral-300 px-4 pt-2 text-xs uppercase">
          Quản trị đơn hàng
        </Link>
      </header>

      <p className="mt-6 max-w-3xl text-sm leading-6 text-neutral-600">
        Chỉ sử dụng khi giao dịch đã thanh toán nhưng đơn bị thất lạc và khách không thể tự hủy.
        Đơn khách tự hủy vẫn dùng cơ chế hoàn tiền tự động hiện tại.
      </p>
      <ZaloPayRefundAdmin />
    </main>
  );
}
