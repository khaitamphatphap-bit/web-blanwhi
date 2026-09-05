import Link from "next/link";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode } from "@/lib/orders";
import { verifyVnpayParams } from "@/lib/payment";
import { markVerifiedPayment, reconcileZaloPayPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";
import { money } from "@/lib/pricing";
import { BankTransferConfirm } from "./BankTransferConfirm";
import { shortOrderCode } from "@/lib/order-code";
import { DemoPaymentActions } from "./DemoPaymentActions";
import { PaymentResultRecovery } from "./PaymentResultRecovery";
import { CustomerOrderLink } from "./CustomerOrderLink";
import type { ShopOrder } from "@/lib/types";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function valueOf(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] : input;
}

function orderCodeFromZaloPayAppTransId(appTransId: string) {
  return appTransId.includes("_") ? appTransId.split("_").slice(1).join("_") : "";
}

function toUrlSearchParams(params: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const text = valueOf(value);
    if (text !== undefined) searchParams.set(key, text);
  });
  return searchParams;
}

function isFailedZaloPayRedirect(params: Record<string, string | string[] | undefined>) {
  const status = String(valueOf(params.status) || "").trim().toLowerCase();
  const returnCode = String(valueOf(params.returncode) || valueOf(params.return_code) || "").trim().toLowerCase();
  const resultCode = String(valueOf(params.resultcode) || valueOf(params.resultCode) || "").trim().toLowerCase();
  return ["0", "-1", "2", "failed", "fail", "cancelled", "canceled", "cancel"].includes(status)
    || ["0", "-1", "2", "failed", "fail", "cancelled", "canceled", "cancel"].includes(returnCode)
    || ["0", "-1", "2", "failed", "fail", "cancelled", "canceled", "cancel"].includes(resultCode);
}

async function reconcileReturnedZaloPayOrder(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>, appTransId: string) {
  const integrations = await readIntegrationConfig();
  let current: ShopOrder = { ...order, paymentProviderOrderId: appTransId || order.paymentProviderOrderId || order.providerOrderId };
  for (let attempt = 0; attempt < 3 && current.status === "pending"; attempt += 1) {
    current = await reconcileZaloPayPayment(current, integrations.payment).catch(() => current);
    if (current.status === "paid") break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  return current;
}

export default async function PaymentResultPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const zaloPayAppTransId = valueOf(params.apptransid) || valueOf(params.app_trans_id) || "";
  const orderCode = valueOf(params.orderCode) || valueOf(params.vnp_TxnRef) || valueOf(params.orderId) || orderCodeFromZaloPayAppTransId(zaloPayAppTransId) || "";
  const provider = valueOf(params.provider) || "payment";
  const fromAdmin = valueOf(params.from) === "admin";
  const demo = valueOf(params.demo) === "1";
  const bankConfirmed = valueOf(params.bankConfirmed) === "1";
  let order = orderCode ? await findOrderByCode(orderCode) : null;

  const isZaloPayRedirect = provider === "zalopay" || Boolean(valueOf(params.apptransid));
  if (isZaloPayRedirect && order && order.status === "pending" && !isFailedZaloPayRedirect(params)) {
    // Redirect chỉ là tín hiệu để hỏi lại ZaloPay. Chỉ API query/IPN có chữ ký
    // mới được đổi đơn sang paid, tránh URL giả làm đơn được miễn COD trên POS.
    order = await reconcileReturnedZaloPayOrder(order, zaloPayAppTransId);
  }

  if (provider === "vnpay" && order && order.status === "pending" && valueOf(params.vnp_ResponseCode)) {
    const integrations = await readIntegrationConfig();
    const query = toUrlSearchParams(params);
    const verified = verifyVnpayParams(query, integrations.payment);
    const amount = Number(query.get("vnp_Amount") || 0) / 100;
    if (verified.ok && query.get("vnp_ResponseCode") === "00" && amount === order.total) {
      const paid = await markVerifiedPayment(order.code, {
        transactionId: query.get("vnp_TransactionNo") || undefined,
        providerMessage: "VNPAY verified return payment success"
      });
      order = await syncVerifiedOrderToPos(paid);
    }
  }

  const success = order?.status === "paid";
  const failed = order?.status === "failed" || order?.status === "cancelled";
  const bankTransferPending = order?.paymentMethod === "bank_transfer" && order.status === "pending";
  const shouldRecoverMissingZaloPayOrder = isZaloPayRedirect && !order && Boolean(orderCode) && !isFailedZaloPayRedirect(params);
  const successTitle = order?.paymentMethod === "bank_transfer"
    ? "Đã nhận chuyển khoản thành công"
    : "Chúc mừng bạn đã thanh toán thành công";

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 md:my-16 md:px-12">
      <Link href="/" className="text-xs uppercase text-neutral-500">BLANWHI</Link>
      <section className="mt-10 border-y border-neutral-200 py-10">
        <p className="text-xs uppercase text-neutral-500">Payment result · {provider}</p>
        <h1 className="mt-3 text-4xl font-medium">
          {success ? successTitle : failed ? "Thanh toán thất bại" : "Đơn hàng đang chờ thanh toán"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-neutral-500">
          Mã đơn: <strong className="text-black">{shortOrderCode(order?.code || orderCode) || "Không tìm thấy"}</strong>
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
        {bankTransferPending && order && <BankTransferConfirm orderCode={order.code} />}
        {bankConfirmed && success && (
          <div className="mt-6 border border-emerald-600 bg-emerald-50 p-4 text-sm text-emerald-800">
            Đơn hàng đã được cập nhật sang trạng thái đã thanh toán.
          </div>
        )}
        <PaymentResultRecovery orderCode={orderCode} shouldRecover={shouldRecoverMissingZaloPayOrder} />
        {!fromAdmin && orderCode && <CustomerOrderLink />}
      </section>
      <div className="mt-8 flex flex-wrap gap-3">
        {fromAdmin ? (
          <Link href="/admin/orders" className="inline-flex h-11 items-center border border-black px-5 text-sm uppercase">Danh sách đơn hàng</Link>
        ) : (
          <>
            <Link href="/" className="inline-flex h-11 items-center border border-black px-5 text-sm uppercase">Về trang chủ</Link>
            {orderCode && <Link href={`/?orderCode=${orderCode}#orders`} className="inline-flex h-11 items-center border border-black px-5 text-sm uppercase">Xem trạng thái đơn</Link>}
          </>
        )}
      </div>
    </main>
  );
}
