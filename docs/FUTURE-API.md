# Đề xuất: API theo nghiệp vụ (chưa triển khai)

## Vấn đề hiện tại

Mỗi lần lưu, trình duyệt gửi **toàn bộ** dữ liệu và máy chủ xóa rồi ghi lại mọi bảng. Hệ quả:

- payload và thời gian lưu tăng tuyến tính theo sổ kho và ảnh (giới hạn hiện tại 16 MB, 200.000 dòng sổ kho);
- hai người làm hai việc **khác nhau** (một người nhập kho, một người sửa hồ sơ NCC) vẫn xung đột (`409`) vì dùng chung một số phiên bản;
- quyền của nhân viên kho phải suy ra bằng cách so sánh toàn bộ dữ liệu cũ/mới (`warehouseChangeError`), phức tạp và dễ sai (đã sửa một lỗi kiểu này ở Phase 6);
- id tự tăng của sổ kho bị tạo lại mỗi lần lưu.

## Đề xuất

Thêm các endpoint, mỗi endpoint là **một transaction** ở máy chủ, tự tính tồn và sổ kho:

| Endpoint | Việc máy chủ làm trong transaction |
|---|---|
| `POST /api/receipts` | tạo phiếu nhập + chi tiết; thêm dòng sổ kho `Nhập`; cộng tồn; cập nhật giá gần nhất |
| `PUT /api/receipts/:id` (admin) | đảo dòng sổ kho cũ, ghi dòng mới, lưu lịch sử sửa; từ chối nếu tồn âm |
| `DELETE /api/receipts/:id` (admin) | đảo tồn; xóa mềm (`deleted_at`) thay vì xóa cứng để giữ lịch sử |
| `POST /api/issues` (+ `PUT`/`DELETE`) | như trên; kiểm tra tồn và định mức đơn hàng **trong** transaction |
| `POST /api/counts` | phiếu kiểm kê; dòng sổ kho `Kiểm kê` = chênh lệch so với tồn **tại thời điểm ghi** |
| `POST/PUT /api/materials`, `/api/suppliers`, `/api/customers`, `/api/orders` | CRUD danh mục; đổi tên cập nhật tham chiếu trong cùng transaction |
| `GET /api/ledger?code=&from=&to=&cursor=` | sổ kho phân trang thay vì tải toàn bộ |

Đồng thời: mỗi bản ghi có cột `updated_at`/`row_version` để phát hiện xung đột ở mức bản ghi (chỉ 409 khi hai người sửa **cùng** bản ghi). Phiếu nhập/xuất/kiểm kê chỉ thêm mới nên hầu như không còn xung đột.

## Toàn vẹn dữ liệu

- Máy chủ là nơi duy nhất tính tồn: `materials.quantity` chỉ thay đổi cùng lúc với việc chèn dòng `ledger`, trong cùng transaction. Có thể thêm kiểm tra định kỳ `quantity = SUM(ledger.quantity)`.
- Chuẩn hóa dần: `document_lines` (thay `detail_json`), khóa ngoại `ledger.material_code → materials.code`, `issues.order_id → orders.id`, CHECK `quantity >= 0`.
- Ngày lưu dạng ISO `YYYY-MM-DD` trong cột mới; giữ cột cũ đến khi chuyển xong.
- Ảnh chuyển sang file trên đĩa hoặc S3, database chỉ lưu đường dẫn.

## Chuyển đổi và tương thích

1. **Bước 1 — thêm, không bỏ:** thêm các endpoint mới bên cạnh `GET/PUT /api/state`. `PUT /api/state` vẫn hoạt động; các endpoint mới tăng cùng số phiên bản để client cũ nhận `409` và tải lại thay vì ghi đè.
2. **Bước 2 — chuyển từng màn hình:** nhập kho → xuất kho → kiểm kê → danh mục. Mỗi màn hình gọi endpoint riêng rồi cập nhật dữ liệu cục bộ từ phản hồi. Test của phase hiện tại (`src/__tests__/`) chuyển sang kiểm tra endpoint mới.
3. **Bước 3 — migration schema:** mỗi thay đổi bảng là một migration Prisma, có script chuyển dữ liệu chạy thử trên bản sao database production, backup trước khi chạy; không đổi khóa chính và mã phiếu đang được tham chiếu.
4. **Bước 4 — bỏ `PUT /api/state`:** khi không màn hình nào còn dùng; `GET /api/state` có thể giữ lại (hoặc thay bằng các endpoint đọc phân trang).

## Thay đổi frontend

- Thay `persist()` (gửi toàn bộ) bằng các hàm gọi endpoint theo thao tác; xử lý `409` theo bản ghi.
- Không còn tự tính tồn ở trình duyệt khi lưu (vẫn có thể tính để hiển thị trước).
- Sổ kho và danh sách phiếu tải theo trang/bộ lọc.

## Ước lượng

Khoảng 2–4 tuần cho một lập trình viên quen mã nguồn, chủ yếu ở bước 2 và test. Nên làm khi sổ kho vượt khoảng 50.000 dòng, khi xung đột `409` xảy ra thường xuyên, hoặc khi số người dùng tăng.
