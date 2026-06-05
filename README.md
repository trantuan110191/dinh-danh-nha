# App tra cứu địa bàn CSKV

App này tra cứu nhanh theo dữ liệu trong Google Sheet `PROJECT DINH DANH NHA`.

Link online GitHub Pages sau khi deploy:

```text
https://trantuan110191.github.io/dinh-danh-nha/
```

## Cách app đối chiếu dữ liệu

- Sheet `Dinh danh NHA`: tìm theo cột C `Tên gọi` hoặc cột D `Địa chỉ trong sổ đỏ`, lấy mã tổ dân phố ở cột F.
- Sheet `To dan pho`: dùng mã tổ dân phố ở cột A để lấy mã `CSKV`, `SĐT`, mã `Hình sự`, `SĐTHS`.
- Sheet `Cán bộ`: dùng mã cán bộ ở cột A để lấy tên đầy đủ ở cột D.

## Preview local

Mở `index.html` hoặc chạy server local để app thử nạp dữ liệu trực tiếp từ link Google Sheet.

Lưu ý: trình duyệt chỉ đọc trực tiếp được Google Sheet khi file được chia sẻ ở chế độ `Bất kỳ ai có đường liên kết đều có thể xem` hoặc sheet đã được publish. Nếu sheet đang riêng tư, hãy dùng bản Google Apps Script ở dưới. Để xem dữ liệu mẫu CN2, mở URL với `?sample=1`.

## Deploy GitHub Pages

App là web tĩnh, deploy miễn phí qua GitHub Pages:

```bash
npm run build
git add .
git commit -m "Update lookup app"
git push
```

## Triển khai bằng Google Apps Script

1. Mở Google Sheet `PROJECT DINH DANH NHA`.
2. Vào `Tiện ích mở rộng` -> `Apps Script`.
3. Tạo hoặc thay các file trong Apps Script bằng nội dung tương ứng:
   - `Code.gs` từ `apps-script/Code.gs`
   - `Index.html` từ `apps-script/Index.html`
   - `Stylesheet.html` từ `apps-script/Stylesheet.html`
   - `Javascript.html` từ `apps-script/Javascript.html`
4. Chọn `Deploy` -> `New deployment` -> loại `Web app`.
5. Chọn `Execute as: Me`, quyền truy cập tùy nhu cầu, rồi deploy.

Sau khi deploy, web app sẽ đọc trực tiếp spreadsheet thật bằng quyền của tài khoản triển khai.
Dữ liệu được cache 5 phút để tìm kiếm nhanh hơn; nếu vừa sửa sheet và muốn cập nhật ngay, chạy hàm `refreshLookupCache` trong Apps Script.
