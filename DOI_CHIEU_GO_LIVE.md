# Đối chiếu Hoàng Nhật SCM local với dashboard tham chiếu

> **Lưu ý (14/10/2026):** tài liệu này viết cho phiên bản cũ (backend Python `server.py`, triển khai Render/PostgreSQL). Kiến trúc hiện tại (Node.js/TypeScript, Prisma + SQLite, Docker Compose + Caddy trên EC2) xem `README.md` và `docs/DEPLOY.md`. Phần mô tả chức năng nghiệp vụ vẫn còn giá trị tham khảo.

Ngày rà soát: 13/10/2026. So sánh với trang `/xuat-kho`, các màn hình danh bạ, kiểm kê, cài đặt, phiếu nhập và đơn hàng trong ảnh người dùng gửi. Chỉ thao tác dữ liệu thử trong database QA cục bộ; không sửa dữ liệu trên website tham chiếu.

## Đã làm trong bản local

| Khu vực | Trạng thái local sau lần rà này |
|---|---|
| Điều hướng và tài khoản | Sidebar có vùng cuộn khi nội dung dài; avatar quản trị hiện chữ QV; menu tài khoản có đổi mật khẩu/đăng xuất. |
| Danh mục NVL và sổ kho | Tìm/lọc, tồn, ngưỡng, CSV/Excel, giao dịch nhập/xuất/kiểm kê và tổng quan. |
| Kiểm kê | Hướng dẫn, lọc theo nhóm, điền tồn hệ thống, ghi chênh, ghi chú, lưu phiếu chung và xem lịch sử. |
| Nhập/xuất kho | Phiếu nhiều dòng, nhà cung cấp theo từng dòng nhập, đơn giá, tổng tiền, ghi chú, tồn sau, lịch sử sửa và quyền sửa/xóa cho quản trị. |
| Nhà cung cấp | Ảnh/logo tải lên và nén, thông tin liên hệ, phân loại, tỷ giá quy đổi tham khảo, quản lý loại NCC; thêm/sửa/xóa sản phẩm hoặc mẫu có ảnh và giá tham khảo. |
| Đơn hàng may | Hợp đồng khách hàng/ngày ký, sản phẩm, số lượng/đơn vị, phần trăm xuất dư, định mức NVL, ảnh, ghi chú và phiếu xuất liên kết. Backend cũng từ chối phiếu vượt tổng định mức cộng phần trăm cho phép. |
| Cài đặt | Tài khoản nội bộ, kiểm tra một số trường dữ liệu, mẫu nhập CSV và xuất Excel 4 sheet. |
| An toàn ghi dữ liệu | Xung đột phiên được phát hiện; nhân viên kho bị chặn sửa danh mục/danh bạ/chứng từ cũ ở API; chi tiết phiếu và số liệu tồn được đối chiếu. |

## Các khác biệt lớn còn lại

| Chức năng trên tham chiếu / ảnh | Trạng thái | Tác động |
|---|---|---|
| FIFO theo lô, đối chiếu tồn với lô, định giá lại và giá vốn xuất | Chưa triển khai | Không dùng local để chốt giá vốn, giá trị kế toán hoặc báo cáo lãi/lỗ. |
| 4 vai trò (quản trị, giám đốc, thủ kho trưởng, thu mua), quyền xem giá/NCC theo vai trò | Mới có 2 vai trò | Chưa phù hợp để phân tách quyền cho nhóm nội bộ như hệ thống tham chiếu. |
| Đăng nhập thẻ và PIN | Chưa triển khai | Chỉ đăng nhập bằng tài khoản/mật khẩu. |
| Workflow duyệt phiếu, audit log quản trị đầy đủ và nhật ký bất biến | Chưa đủ | Lịch sử sửa phiếu đã có; chưa thay thế được audit trail cấp hệ thống. |
| Sản phẩm của NCC | Đã có danh sách riêng, ảnh và giá tham khảo | Chưa có toàn bộ thuộc tính/luồng mua hàng sâu như phần mềm ERP chuyên biệt. |
| Ngoại tệ | Có trường tiền tệ/tỷ giá và phép tính quy đổi | Chưa có danh mục tiền tệ chuẩn, nguồn tỷ giá tự động hay lịch sử tỷ giá theo ngày. |
| Dữ liệu mẫu tham chiếu | Chưa nhập/migrate | Database local đang là dữ liệu riêng; phải xuất dữ liệu được duyệt, làm sạch, nhập, rồi đối chiếu từng tồn và tổng giá trị trước pilot. Không chép thẳng database đang vận hành. |
| Triển khai production | Chưa triển khai | `render.yaml` mới là cấu hình mẫu; cần tài khoản sở hữu, database, URL/domain, bí mật, backup/restore và người chịu trách nhiệm vận hành. |

## Kết quả kiểm tra

- 9 kiểm thử backend bao gồm đăng nhập, session, phân quyền, phiên dữ liệu xung đột, kiểm kê, chi tiết/lịch sử phiếu, Excel và hạn mức NVL đơn may.
- `python -m py_compile server.py backup.py` thành công.
- Giao diện đã tách thành `index.html`, `static/app.css` và `static/app.js`; server chỉ phục vụ hai asset tĩnh đã định danh.
- Sidebar cuộn được, avatar admin đổi thành QV sau đăng nhập, hồ sơ NCC và sản phẩm NCC có ảnh/logo.
- JavaScript frontend được kiểm tra bằng `node --check` thành công.
- QA trình duyệt với database tách biệt: kiểm kê 10→8, nhập 3, sửa phiếu và tải lại; xác nhận thứ tự sổ và tồn sau là 11. Thêm sản phẩm mẫu NCC và tải lại vẫn còn. Tạo đơn định mức 2 cái, xuất 2,3 bị chặn, xuất 2,2 lưu được; sửa lại phiếu không bị cộng trùng hạn mức.
- Đây là kiểm tra chức năng với dữ liệu thử, chưa phải UAT kho thật, kiểm thử tải, kiểm tra khôi phục backup hoặc nghiệm thu nghiệp vụ.

## Cần hoàn tất trước khi giao khách hàng

1. Chủ kho xác nhận nghiệp vụ nào phải giữ giống hệ thống tham chiếu, đặc biệt FIFO, duyệt phiếu, quyền theo vai trò và dữ liệu đơn hàng.
2. Chọn phạm vi cần hoàn thiện; nếu cần FIFO hoặc bốn vai trò thì bổ sung và chạy kiểm tra nghiệp vụ trước khi nhập dữ liệu thật.
3. Có bản export và backup được chủ dữ liệu cho phép; nhập vào môi trường staging, so sánh số mã, số lượng tồn, phiếu và tổng giá trị; lưu biên bản đối chiếu.
4. Deploy web service và PostgreSQL managed; đặt bí mật bằng trình quản lý secret, bật domain/HTTPS, backup tự động, giám sát lỗi và khôi phục thử.
5. Tổ chức UAT bằng tài khoản đại diện từng vai trò trên máy tính/điện thoại tại kho; chạy nhập, xuất, kiểm kê, sửa/xóa, Excel, cạnh tranh nhiều người dùng và mất mạng.
6. Chỉ đổi sang hệ thống mới sau khi người phụ trách kho và chủ doanh nghiệp ký xác nhận số tồn, quyền truy cập, backup và quy trình quay lui.

**Kết luận:** local đã gần hơn đáng kể với giao diện và luồng kho trong ảnh, nhưng chưa thể gọi là “giống hết” hoặc sẵn sàng go-live. Các hạng mục chặn chính là FIFO, phân quyền chi tiết, PIN thẻ, dữ liệu vận hành được migrate và một lần nghiệm thu trên staging/production.
