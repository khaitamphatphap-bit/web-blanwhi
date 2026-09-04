import { readIntegrationConfig } from "@/lib/integrations";
import { queryZaloPayPayment } from "@/lib/payment";
import type { ShopOrder } from "@/lib/types";

type Props = { searchParams: Promise<{ appTransId?: string }> };

export const dynamic = "force-dynamic";

function queryOrder(appTransId: string): ShopOrder {
  const now = new Date().toISOString();
  const code = appTransId.includes("_") ? appTransId.slice(appTransId.indexOf("_") + 1) : appTransId;
  return {
    id: `zalopay-query-${appTransId}`,
    code,
    status: "pending",
    paymentMethod: "zalopay",
    paymentProvider: "zalopay",
    paymentProviderOrderId: appTransId,
    customer: { name: "Tra cứu ZaloPay", phone: "", address: "" },
    items: [],
    subtotal: 0,
    discount: 0,
    shipping: 0,
    total: 0,
    createdAt: now,
    updatedAt: now
  };
}

export default async function ZaloPayRefundLookupPage({ searchParams }: Props) {
  const appTransId = String((await searchParams).appTransId || "").trim();
  let result: Awaited<ReturnType<typeof queryZaloPayPayment>> | null = null;
  let error = "";
  if (appTransId) {
    try {
      const config = await readIntegrationConfig();
      result = await queryZaloPayPayment(queryOrder(appTransId), config.payment);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Không tra cứu được giao dịch.";
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-neutral-500">BLANWHI ADMIN</p>
      <h1 className="mt-3 text-3xl font-semibold">Tra cứu giao dịch ZaloPay thất lạc</h1>
      <div className="mt-8 border border-neutral-300 p-6">
        <p><b>app_trans_id:</b> {appTransId || "Chưa nhập"}</p>
        {error && <p className="mt-4 text-red-700"><b>Lỗi:</b> {error}</p>}
        {result && (
          <div className="mt-4 space-y-2">
            <p><b>Trạng thái:</b> {Number(result.return_code || 0) === 1 ? "Đã thanh toán" : result.return_message || "Chưa xác nhận"}</p>
            <p><b>Số tiền:</b> {Number(result.amount || 0).toLocaleString("vi-VN")} đ</p>
            <p><b>zp_trans_id:</b> {result.zp_trans_id || "Không có"}</p>
            <p><b>Mã phản hồi:</b> {result.return_code || 0}</p>
            <p><b>Thông báo:</b> {result.sub_return_message || result.return_message || "-"}</p>
          </div>
        )}
      </div>
    </main>
  );
}
