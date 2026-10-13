# Hoàng Nhật SCM

Ứng dụng web quản lý một kho nội bộ. Backend và database chạy phía máy chủ; nhiều nhân viên đăng nhập cùng dữ liệu kho. SQLite phù hợp chạy thử trên một máy. Khi đưa lên Internet, dùng PostgreSQL được quản lý trên máy chủ riêng, không dùng database trên máy người dùng.

## Cấu trúc source

- `server.py`: HTTP server, API, đăng nhập, phân quyền và lớp truy cập SQLite/PostgreSQL.
- `index.html`: khung giao diện và điểm vào ứng dụng.
- `static/app.css`, `static/app.js`: giao diện, kiểu dáng và mã frontend đã tách riêng để dễ xem xét/chỉnh sửa.
- `tests/`: kiểm tra API và nghiệp vụ backend.
- `render.yaml`: cấu hình mẫu để người phụ trách triển khai xem xét.
- `DOI_CHIEU_GO_LIVE.md`: đối chiếu chức năng và các giới hạn còn lại.

Gói source không chứa database `data/scm.sqlite3`, tài khoản/mật khẩu, file backup hoặc secret. Database hiện có trên máy này được giữ riêng, không đưa vào gói gửi đi.

## Chạy ở máy local

1. Cài Python 3.10 trở lên.
2. Mở PowerShell tại thư mục dự án và chạy `python server.py`.
3. Truy cập `http://127.0.0.1:4173`.
4. Lần đầu tạo tài khoản quản trị; mật khẩu tối thiểu 12 ký tự.

Mặc định máy chủ chỉ nghe trên `127.0.0.1`, dữ liệu SQLite ở `data/scm.sqlite3`. Đặt `SCM_DB_PATH` để chọn database khác. Không dùng một file SQLite trên thư mục mạng cho nhiều máy ghi cùng lúc.

Sau khi giải nén gói source, cần giữ nguyên `server.py`, `index.html` và thư mục `static/` cùng cấp. Máy mới sẽ có database riêng; lần đầu mở web sẽ hiện màn hình tạo tài khoản quản trị.

## Chức năng đang có

- Đăng nhập bằng tài khoản riêng, đổi mật khẩu, phiên HttpOnly tối đa 12 giờ và giới hạn đăng nhập sai.
- Hai vai trò: quản trị viên và nhân viên kho. Quyền được kiểm tra ở backend; nhân viên không thể sửa danh mục, danh bạ, sản phẩm NCC, hợp đồng cũ hay giao dịch cũ bằng API.
- Dashboard; danh mục NVL; lọc/tìm; nhập CSV và xuất CSV/Excel.
- Phiếu nhập/xuất nhiều dòng, chi tiết đơn giá/nguồn hàng, ghi chú, tồn sau giao dịch, lịch sử sửa; quản trị viên có thể sửa/xóa phiếu theo kiểm tra tồn.
- Kiểm kê theo nhóm, tạo một phiếu kiểm kê có nhiều mã, ghi chênh lệch và xem các lần kiểm gần đây.
- Sidebar cuộn được trên màn hình thấp; menu tài khoản hiển thị avatar theo người đăng nhập.
- Danh bạ nhà cung cấp có ảnh/logo, loại NCC, liên hệ, địa chỉ, nguồn tìm kiếm, tiền tệ/tỷ giá tham khảo, ngày giao hàng, ghi chú và danh sách sản phẩm/mẫu có ảnh.
- Đơn hàng may có khách hàng, ngày ký, sản phẩm, số lượng/đơn vị, ảnh, ghi chú, định mức NVL và phần trăm xuất dư. Phiếu xuất gắn với đơn được kiểm hạn mức ở cả giao diện và backend.
- Kiểm tra xung đột nếu hai nhân viên lưu từ cùng một phiên dữ liệu cũ.
- Xuất báo cáo Excel 4 sheet và kiểm tra nhanh một số vấn đề chất lượng dữ liệu.

## Cấu hình production mẫu với Render

`render.yaml` khai báo web service và PostgreSQL managed tại Singapore, HTTPS do Render cấp và token thiết lập tài khoản quản trị ban đầu. Để triển khai:

1. Đưa mã nguồn vào Git riêng và kết nối repository với Render.
2. Tạo Blueprint, kiểm tra region, tài nguyên, biến môi trường và phí của cả web service lẫn database trước khi áp dụng.
3. Lấy `SETUP_TOKEN` từ cấu hình service; mở URL HTTPS và tạo admin.
4. Tạo tài khoản cá nhân cho nhân viên, nhập dữ liệu đã được duyệt và đối chiếu tồn đầu kỳ.
5. Cấu hình domain nếu cần, chính sách backup, cảnh báo database và quy trình khôi phục.
6. Pilot với kho thật nhưng chạy song song sổ hiện tại; chốt số liệu và ký xác nhận trước khi đổi hệ thống chính thức.

Chưa có môi trường production nào được tạo hoặc triển khai. Không đưa mật khẩu, setup token, database, backup hay dữ liệu khách hàng vào Git. Backup phải được khôi phục thử nghiệm; chỉ thấy trạng thái backup không chứng minh được khôi phục thành công. Người nhận source cần xem lại cấu hình, giới hạn còn lại và chi phí trước khi tạo dịch vụ thật.

## Backup SQLite local

`python backup.py` tạo bản sao nhất quán của database SQLite trong `backups/`. PostgreSQL production cần dùng backup/restore của nhà cung cấp database.

## Kiểm tra

```powershell
python -m unittest discover -s tests -v
python -m py_compile server.py backup.py
```

Kiểm tra giao diện bằng dữ liệu thử riêng trước khi nhập dữ liệu thật. Tình trạng đối chiếu chức năng và các hạng mục còn thiếu được ghi trong [DOI_CHIEU_GO_LIVE.md](DOI_CHIEU_GO_LIVE.md).

## Chưa tương đương với hệ thống tham chiếu

Bản hiện tại chưa có tính giá vốn theo lô FIFO/định giá lại, đăng nhập thẻ và PIN, bốn vai trò và quyền theo trường/nghiệp vụ, phê duyệt phiếu, audit log đầy đủ, hoặc nhập/migrate toàn bộ lịch sử từ hệ thống tham chiếu. Chưa xác nhận tính đúng của kế toán giá vốn hay quy trình vận hành với doanh nghiệp. Vì vậy đây chưa phải bản đã ký nghiệm thu go-live; cần hoàn tất các mục chặn trước khi giao khách hàng.
