# AVA-TIX dApp v2 (UniHack Avalanche 2026)

## Chạy ứng dụng (Off-chain / Fallback)
```bash
npm install
npm start      # http://localhost:3000
```
Cơ sở dữ liệu SQLite (`avatix.db`) tự tạo và tự động migrate schema. Đổi `SECRET` trong `.env` khi triển khai.
Khuyến nghị Node.js 22 LTS. Cài đúng phiên bản khóa bằng `npm ci` khi chuẩn bị kiểm thử hoặc triển khai.

- `/login.html`: đăng nhập / đăng ký (tự tạo ví EVM xác định cho mỗi user)
- `/customer.html`: khách hàng (mua vé, mở QR động 20s, bán lại giá trần +10%, xem NFT on-chain & lịch sử giao dịch)
- `/organizer.html`: nhà cung cấp (tạo sự kiện, thống kê, soát vé tại cổng, xem lịch sử on-chain)

## Mã bảo mật 6 số và giao diện

- Người đăng ký mới tự chọn và xác nhận mã bảo mật 6 chữ số. Tài khoản cũ chưa có mã vẫn đăng nhập bình thường; có thể tạo mã trong Tài khoản hoặc khi mở QR lần đầu. Không có mã mặc định hoặc mã chung cho tài khoản demo.
- Đăng nhập chỉ cần tên đăng nhập và mật khẩu, kể cả khi PIN đang tạm khóa. PIN chỉ bảo vệ QR và chức năng đổi mật khẩu, cùng thao tác thay chính mã PIN. Mã được băm bằng scrypt với salt riêng và HMAC dùng `SECRET`; giữ `SECRET` ổn định khi khởi động lại hay triển khai lại.
- Nút con mắt hiển thị **mật khẩu đang nhập** ngay, không hỏi PIN, rồi tự che lại sau 15 giây, khi sửa nội dung hoặc chuyển khỏi trang. Không lưu hay cung cấp lại mật khẩu gốc từ cơ sở dữ liệu.
- Mỗi lần mở QR vé đều cần mã bảo mật. Máy chủ kiểm tra quyền mở theo tài khoản, phiên đăng nhập và từng vé, có hiệu lực 2 phút để QR tự đổi sau mỗi 20 giây; hết thời gian phải mở khóa lại. Đổi/khôi phục mã bảo mật vô hiệu hóa quyền mở QR trước đó.
- Đổi mật khẩu của tài khoản đã có PIN yêu cầu nhập PIN một lần khi mở form. Quyền xác nhận có hiệu lực 10 phút, chỉ dùng cho đổi mật khẩu và gắn với phiên hiện tại; không dùng thay quyền mở QR. Gửi OTP và lưu mật khẩu đều kiểm tra quyền này trên máy chủ, cùng mật khẩu hiện tại và OTP email. Đổi PIN hoặc mật khẩu vô hiệu hóa quyền cũ. Tài khoản cũ chưa có PIN dùng mật khẩu hiện tại + OTP email.
- Nhập sai mã 5 lần sẽ khóa trong 5 phút; giới hạn lưu trong cơ sở dữ liệu và dùng chung giữa các phiên. Khôi phục mã bằng mật khẩu tài khoản và OTP thật gửi về email đã xác thực, kể cả khi chưa đăng nhập.
- Mục Tài khoản có nút **Đổi mật khẩu** riêng. Chọn **Menu → Giao diện → Sáng / Tối** để đổi màu toàn trang, kể cả trước khi đăng nhập. Lựa chọn được nhớ trên trình duyệt và áp dụng khi tải lại hoặc chuyển trang. Loại tài khoản và nhãn **Số dư:** hiển thị rõ trong cả hai giao diện, trên máy tính và điện thoại.
- Thẻ sự kiện và ô thống kê dùng các tông tím, xanh ngọc, cam sáng với chữ tối; nền trang và các khung thao tác đổi theo giao diện. QR luôn nằm giữa khung vuông trắng và co theo màn hình điện thoại.

Mỗi địa chỉ email và số điện thoại chỉ được đăng ký cho một tài khoản. Email được cắt khoảng trắng và chuyển về chữ thường trước khi so sánh; số điện thoại giữ số 0 đầu. Máy chủ và database cùng chặn trùng, kể cả hai yêu cầu đồng thời, và trả lỗi HTTP 409 rõ ràng. Migration giữ nguyên tài khoản cũ nếu dữ liệu đã có trùng, nhưng ngăn tài khoản mới dùng lại thông tin đó và ngăn hai tài khoản xác thực cùng email.

Kiểm thử ứng dụng: `npm run test:app`. Các kiểm thử dùng dữ liệu riêng, không thay mã bảo mật của tài khoản đang dùng và không gửi thư thật.

## Quản lý avatar

Mở nút menu ba sọc để vào Tài khoản, Vé của tôi, Chợ vé, Lịch sử on-chain hoặc Đăng xuất. Trong Tài khoản, chọn ảnh từ thiết bị, kéo ảnh để đổi vị trí và dùng thanh thu phóng để căn vào khung vuông trước khi lưu. Ảnh được lưu vào tài khoản trên cơ sở dữ liệu (cả SQLite và Turso), dùng lại sau khi đăng nhập.

Trình duyệt xử lý các định dạng ảnh mà thiết bị hỗ trợ; máy chủ bổ sung chuyển đổi TIFF và HEIC/HEIF khi cần. Ảnh gốc tối đa 8 MiB, chuyển đổi máy chủ tối đa 40 megapixel. Ảnh động dùng khung hình đầu; dữ liệu lưu là WebP tĩnh 512×512 đã bỏ metadata. Một số định dạng RAW hoặc codec đặc biệt có thể không đọc được; giao diện sẽ hướng dẫn chọn ảnh khác thay vì lưu tệp lỗi.

## Gửi OTP thật qua Gmail

Mỗi người dùng nhận OTP tại **địa chỉ email đã đăng ký của chính họ**. `SMTP_USER` là tài khoản gửi thư của AVA-TIX, không thay thế email người nhận.

1. Sao chép `.env.example` thành `.env`. Với Gmail gửi thư, bật [xác minh 2 bước và tạo App Password](https://support.google.com/mail/answer/185833). Không dùng mật khẩu đăng nhập Gmail thông thường.
2. Cấu hình `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER` là Gmail gửi thư và `SMTP_PASS` là App Password. Có thể dùng cổng `587` với `SMTP_SECURE=false` để kết nối STARTTLS. Tham khảo [cấu hình SMTP của Google](https://developers.google.com/workspace/gmail/imap/imap-smtp).
3. Khởi động lại máy chủ, đăng ký bằng địa chỉ email thật rồi chọn **Gửi mã OTP**. Kiểm tra Hộp thư đến và Spam. Máy chủ triển khai phải cho phép kết nối SMTP ra ngoài.

Không cấu hình SMTP hoặc gửi thư lỗi sẽ báo lỗi rõ ràng; không có OTP mẫu hiện trên màn hình, trong phản hồi API hay nhật ký máy chủ. Mã chỉ dùng được sau khi máy chủ thư chấp nhận gửi, có hiệu lực 5 phút, tối đa 5 lần nhập sai, và chờ 30 giây giữa các lần gửi thành công. Các thao tác mua vé cũng cần OTP thật. Tài khoản demo dùng email mẫu, nên hãy dùng tài khoản đăng ký với email thật để nhận thư.

Giữ `.env`, App Password và khóa ví ngoài Git. Nếu đã lộ App Password, thu hồi trong tài khoản Google rồi tạo lại.

## Kiểm thử máy chủ

```bash
node --test tests/backend.test.js tests/mailer.test.js
```

Các kiểm thử dùng SQLite trong bộ nhớ và bộ gửi thư thay thế; không gửi email thật. Kiểm thử kiểm tra ảnh đại diện qua phiên đăng nhập, giới hạn upload, xác thực OTP, giới hạn nhập sai và hành vi khi gửi thư thất bại. Kiểm thử contract vẫn chạy riêng như bên dưới.

## Tích hợp Smart Contract (Hybrid Relayer)

`contracts/AvaTicket.sol` + `contracts/TicketMarketplace.sol` đã được tích hợp vào `server.js` thông qua `blockchain.js` (mô hình Relayer gasless cho user).

### 1. Chạy test Smart Contract
```bash
npm run test:contracts
```

### 2. Chạy thử với Hardhat Local Node (không cần AVAX faucet)
Mở 2 terminal:
```bash
# Terminal 1: Khởi động local EVM node
npm run chain

# Terminal 2: Deploy contract (tự cập nhật .env) rồi chạy app
npm run deploy:local
npm start
```

### 3. Deploy lên Avalanche Fuji Testnet (Chain ID: 43113)
1. Sao chép `.env.example` thành `.env` (hoặc chạy `node scripts/gen-wallet.js` để tạo ví mới).
2. Nạp AVAX testnet cho địa chỉ `DEPLOYER_ADDRESS` tại [Avalanche Fuji Faucet](https://faucet.avax.network) hoặc [Core Faucet](https://core.app/tools/testnet-faucet/).
3. Deploy & khởi chạy:
```bash
npm run deploy:fuji
npm start
```
Mọi giao dịch mua vé, bán lại và check-in sẽ được ghi nhận on-chain và hiển thị link Snowtrace Testnet trong mục **Lịch sử on-chain** và **Xem On-chain**.

## Lưu ý
- Nạp tiền (MoMo/Ngân hàng/VNPAY/VietQR) và xác minh CCCD đang mô phỏng trong SQLite; các thao tác vé cốt lõi (mint, resale cap, atomic transfer, dynamic QR check-in) đã kết nối trực tiếp với smart contract qua Relayer.
