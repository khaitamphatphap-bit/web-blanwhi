# BLANWHI Web

Website bán hàng BLANWHI gồm trang khách mua hàng, trang kết quả thanh toán và trang admin để sửa nội dung, ảnh, sản phẩm, đơn hàng, tích hợp vận chuyển/POS/MISA.

## Chạy local

```bash
npm install
npm run dev
```

Mở:

- Trang khách: `http://127.0.0.1:3000/preview.html`
- Admin nội dung: `http://127.0.0.1:3000/admin/site`
- Admin đơn hàng: `http://127.0.0.1:3000/admin/orders`

Khi chạy local mà chưa đặt `ADMIN_USERNAME` và `ADMIN_PASSWORD`, admin được mở để test nhanh. Khi deploy production, thiếu 2 biến này thì admin sẽ bị khóa.

## Biến môi trường cần có khi deploy

Tạo các biến này trên Vercel hoặc hosting production:

```bash
NEXT_PUBLIC_SITE_URL=https://www.blanwhi.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-strong-password
ENABLE_DEMO_PAYMENTS=false

VNPAY_TMN_CODE=
VNPAY_HASH_SECRET=
VNPAY_PAYMENT_URL=https://pay.vnpay.vn/vpcpay.html

MOMO_ENDPOINT=https://payment.momo.vn/v2/gateway/api/create
MOMO_PARTNER_CODE=
MOMO_ACCESS_KEY=
MOMO_SECRET_KEY=
```

Các biến tích hợp vận hành:

```bash
PANCAKE_POS_ENDPOINT=
PANCAKE_POS_TOKEN=
MISA_ENDPOINT=
MISA_TOKEN=
SHIPPING_PROVIDER=ghn
SHIPPING_PROVIDER_NAME=Giao Hàng Nhanh
SHIPPING_STATUS_ENDPOINT=
SHIPPING_TOKEN=
SHIPPING_SHOP_ID=
SHIPPING_CLIENT_ID=
```

## Deploy domain thật bằng Vercel

1. Đẩy code lên GitHub.
2. Vào Vercel, import repo `web-blanwhi`.
3. Build command: `npm run build`.
4. Output/framework: Next.js, Vercel tự nhận.
5. Thêm toàn bộ biến môi trường production ở trên.
6. Deploy.
7. Vào Vercel project, thêm domain thật của shop.
8. Ở nơi mua domain, trỏ DNS theo hướng dẫn của Vercel.
9. Sau khi DNS nhận, đặt `NEXT_PUBLIC_SITE_URL` bằng domain thật rồi redeploy.

## Các URL quan trọng sau deploy

- Trang khách: `https://www.blanwhi.com`
- Admin nội dung: `https://www.blanwhi.com/admin/site`
- Admin đơn hàng: `https://www.blanwhi.com/admin/orders`
- Kết quả thanh toán: `https://www.blanwhi.com/payment-result`
- MoMo IPN: `https://www.blanwhi.com/api/payments/momo-ipn`
- VNPAY IPN/return: `https://www.blanwhi.com/api/payments/vnpay-ipn`
- Webhook vận chuyển: `https://www.blanwhi.com/api/webhooks/shipping`
- Webhook MISA: `https://www.blanwhi.com/api/webhooks/misa`
- Webhook Pancake: `https://www.blanwhi.com/api/webhooks/pancake`

## Lưu ý trước khi nhận đơn thật

Hiện dữ liệu đang lưu trong các file JSON trong thư mục `data/`. Cách này ổn để demo/local, nhưng production nên chuyển sang database thật như Supabase/Postgres để đơn hàng, sản phẩm và nội dung admin không bị mất khi server rebuild.

Thanh toán production sẽ không tự chạy demo nếu thiếu key merchant. Cần đăng ký merchant thật với VNPAY/MoMo và điền key trước khi nhận tiền thật.
