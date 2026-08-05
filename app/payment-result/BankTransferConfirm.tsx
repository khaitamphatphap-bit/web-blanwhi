"use client";

import Link from "next/link";

export function BankTransferConfirm({ orderCode }: { orderCode: string }) {
  return (
    <div className="mt-6 border border-black p-5">
      <p className="text-sm leading-6 text-neutral-600">
        Đơn chỉ chuyển sang “Đã thanh toán” sau khi hệ thống nhận được xác nhận tiền vào từ ngân hàng. Việc khách tự bấm không thể thay thế xác nhận giao dịch.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={`/payment-result?provider=bank_transfer&orderCode=${orderCode}`} className="inline-flex h-11 items-center bg-black px-5 text-xs uppercase text-white">Kiểm tra thanh toán</Link>
        <Link href={`/?orderCode=${orderCode}#orders`} className="inline-flex h-11 items-center border border-black px-5 text-xs uppercase">
          Xem trạng thái đơn
        </Link>
      </div>
    </div>
  );
}
