import Link from "next/link";

export function BankTransferConfirm({ orderCode }: { orderCode: string }) {
  return (
    <div className="mt-6 border border-amber-500 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
      <p>Giao dịch đang chờ webhook có chữ ký hợp lệ từ cổng thanh toán. Khách hàng không thể tự xác nhận đã chuyển khoản.</p>
      <Link href={`/?orderCode=${orderCode}#orders`} className="mt-4 inline-flex h-11 items-center border border-black px-5 text-xs uppercase text-black">
        Xem trạng thái đơn
      </Link>
    </div>
  );
}
