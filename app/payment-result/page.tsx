import Link from "next/link";
import { findOrderByCode } from "@/lib/orders";
import { money } from "@/lib/pricing";
import { DemoPaymentActions } from "./DemoPaymentActions";
import { PaymentStatusWatcher } from "./PaymentStatusWatcher";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function valueOf(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] : input;
}

export default async function PaymentResultPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const orderCode = valueOf(params.orderCode) || valueOf(params.vnp_TxnRef) || valueOf(params.orderId) || "";
  const provider = valueOf(params.provider) || "payment";
  const demo = valueOf(params.demo) === "1";
  const order = orderCode ? await findOrderByCode(orderCode) : null;
  const success = order?.status === "paid";
  const failed = order?.status === "failed" || order?.status === "cancelled";
  const bankTransferPending = order?.paymentMethod === "bank_transfer" && order.status === "pending";

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 md:my-16 md:px-12">
      <Link href="/" className="text-xs uppercase text-neutral-500">BLANWHI</Link>
      <section className="mt-10 border-y border-neutral-200 py-10">
        <p className="text-xs uppercase text-neutral-500">Payment result · {provider}</p>
        {success && <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-4xl text-white" aria-label="Thanh to?n th?nh c?ng">?</div>}
        <h1 className="mt-3 text-4xl font-medium">
          {success && order?.paymentMethod === "bank_transfer" ? "Đã nhận chuyển khoản thành công" : success ? "Thanh toán thành công" : failed ? "Thanh toán thất bại" : "Đơn hàng đang chờ thanh toán"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-neutral-500">
          Mã đơn: <strong className="text-black">{orderCode || "Không tìm thấy"}</strong>
        </p>
        {order && (
          <div className="mt-6 grid gap-3 bg-neutral-50 p-5 text-sm">
            <div className="flex justify-between"><span>Khách hàng</span><span>{order.customer.name}</span></div>
            <div className="flex justify-between"><span>Phương thức</span><span>{order.paymentMethod}</span></div>
            <div className="flex justify-between"><span>Trạng thái</span><span className="uppercase">{order.status}</span></div>
            <div className="flex justify-between text-lg"><span>Tổng tiền</span><span>{money(order.total)}</span></div>
          </div>
        )}
        {demo && order && order.paymentMethod !== "bank_transfer" && (
          <div className="mt-6 border border-dashed border-neutral-300 p-4">
            <p className="text-sm text-neutral-600">
              Chế độ demo: chưa cấu hình key merchant nên bạn có thể giả lập kết quả IPN để kiểm thử quản trị đơn.
            </p>
            <DemoPaymentActions orderCode={order.code} />
          </div>
        )}
        {bankTransferPending && (
          <div className="mt-6 border border-amber-500 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
            Giao dịch chưa được ngân hàng xác nhận. Đơn chỉ được chuyển sang đã thanh toán và gửi sang POS sau khi hệ thống nhận webhook có chữ ký hợp lệ từ cổng thanh toán.
            <PaymentStatusWatcher orderCode={order.code} />
          </div>
        )}
      </section>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="inline-flex h-11 items-center border border-black px-5 text-sm uppercase">Về trang chủ</Link>
        {orderCode && <Link href={`/?orderCode=${orderCode}#orders`} className="inline-flex h-11 items-center border border-black px-5 text-sm uppercase">Xem trạng thái đơn</Link>}
        <Link href="/admin/orders" className="inline-flex h-11 items-center bg-black px-5 text-sm uppercase text-white">Xem quản trị đơn</Link>
      </div>
    </main>
  );
}
