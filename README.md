# Google Drive ↔ Koofr Backup

Tự động đồng bộ hai chiều Google Drive và thư mục `koofr:/GoogleBackup` bằng Rclone Bisync.

[![Daily backup](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/workflows/bisync.yml/badge.svg?branch=main)](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/workflows/bisync.yml)

## Báo cáo backup

**Trạng thái workflow mới nhất:** xem badge ở trên (tự cập nhật theo GitHub Actions). **Chi tiết lượt chạy mới nhất:** [GitHub Actions](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/workflows/bisync.yml).

### Kết quả đã xác minh — 14/10/2026

| Chỉ số | Kết quả |
|---|---|
| Run | [#38482597215](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38482597215) |
| Rclone Bisync | **Thành công** (`exit code 0`) |
| Dữ liệu truyền | **20.834 GiB** (100% theo Rclone) |
| Tốc độ trung bình | **6.901 MiB/s** |
| File đang bỏ qua | **28** |
| File mới bị bỏ qua | **0** |
| Lỗi không thể bỏ qua | **Không** |
| Lưu trạng thái cho lần tiếp theo | **Thành công** |
| Hoàn tất | **07:56:52, giờ Việt Nam** |

> **Lưu ý:** Các số liệu trong bảng là ảnh chụp của lượt chạy 14/10/2026, **không tự cập nhật**. Badge trạng thái và trang Actions ở trên phản ánh các lượt chạy mới. Dữ liệu 100% không bao gồm 28 file đã được cấu hình bỏ qua.

**Cảnh báo:** Log ghi nhận một Google Drive shortcut bị hỏng (dangling shortcut); không làm lượt đồng bộ thất bại. Rà soát danh sách file bỏ qua trong artifact để tránh bỏ sót dữ liệu quan trọng.

[**Xem báo cáo và tải log của lượt chạy 14/10/2026**](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38482597215/artifacts/11861574820)

## Thư mục loại trừ

- `Tapo-Archive/` ở thư mục gốc Google Drive và Koofr được loại trừ khỏi bisync, gồm toàn bộ tệp và thư mục con.
- Bộ lọc được tạo trong `scripts/bisync-helper.py`; không tự xóa dữ liệu Tapo đã có trên Koofr.
- **Thay đổi bộ lọc làm thay đổi checksum của trạng thái bisync.** Lần chạy đầu sau thay đổi có thể yêu cầu chạy `--resync` có kiểm soát để tái tạo baseline. Không bật `reset` hoặc xóa dữ liệu tự động.
- Muốn thu hồi dung lượng, cần kiểm tra và xóa riêng bản sao `GoogleBackup/Tapo-Archive` trên Koofr sau khi xác nhận dữ liệu gốc trên Google Drive còn đầy đủ.

## Lịch chạy và an toàn

- Đồng bộ hằng ngày lúc **02:00 giờ Việt Nam** theo [workflow](.github/workflows/bisync.yml).
- **Tự động:** Tối đa **35 phút/job**, gồm **29 phút** cho Rclone Bisync và thời gian dự phòng để dừng có kiểm soát, lưu state/cache, artifact và báo cáo. Không dùng hết 5h30 mỗi ngày vì GitHub Actions private có hạn mức miễn phí theo **tháng**.
- **Khôi phục thủ công khi thật cần thiết:** Actions → Run workflow → `extended_budget=true` để cho phép lại **330 phút/job, 300 phút rclone**. Tùy chọn này không tự bật và có nguy cơ tiêu tốn hạn mức miễn phí; `resync/reset` chỉ chọn khi hiểu rõ hậu quả.
- Ngân sách chung của Drive + Google Photos: [FREE_TIER_BUDGET.md](https://github.com/hunghvt-cyber/google-photos-koofr/blob/main/docs/FREE_TIER_BUDGET.md). Lịch Photos Daily giữ hằng ngày; Historical Backfill chạy 4 ngày/tuần để ít tốn overhead Chrome hơn.
- Duy trì trạng thái Bisync giữa các lượt chạy; resync ban đầu chưa hoàn tất sẽ tiếp tục ở lượt sau.
- `--max-delete 25`, `--backup-dir2`, `--recover`, `--resilient`, `--checksum`.
- File không đồng bộ được sẽ được ghi nhận trong danh sách bỏ qua; không nên coi là đã backup.

## Xem báo cáo hằng ngày

Vào [Actions → Two-Way Sync](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/workflows/bisync.yml), mở lượt chạy mới nhất, xem **Summary** và tải artifact `bisync-report-<run_id>` để đọc `bisync.log` và danh sách file bỏ qua.

## Homepage backup report (GAS/Drive hoặc Blob)

Workflow tạo JSON tóm tắt đã lọc từ kết quả hiện có; việc phát báo cáo là best-effort, không thay kết quả backup và không thay dữ liệu/state.

- Actions variable `REPORT_BACKEND=gas-drive`: dùng variable `REPORT_GAS_URL` và secret `REPORT_GAS_KEY`; chạy `scripts/publish_gas_report.py`.
- Khi `REPORT_BACKEND` chưa đặt, source workflow hiện mặc định `blob`; nhánh này dùng `BLOB_READ_WRITE_TOKEN` và `scripts/publish_blob_report.py`. Không có key thì bỏ qua với notice. Đây là lựa chọn tương thích, không chứng minh Homepage đang đọc Blob.
- Homepage hiện chọn API GAS/Drive. Ngày 19/10/2026, hai feed `source=gdrive|gphotos` trả **503 NO_REPORT** trong lượt kiểm kê. Cần xác minh variable, metadata key, lần publish và GAS HEAD/ack trước khi coi chuyển feed hoàn tất. Thiếu feed không đồng nghĩa backup media thất bại.
- Không đưa raw logs, tên file, cookie hoặc credentials vào báo cáo. Không đổi lịch, filter, reset/resync hoặc token để sửa câu chữ tài liệu.

Nguồn hiện hành: [Homepage OPERATIONS](https://github.com/hunghvt-cyber/Homepage-nas/blob/main/docs/OPERATIONS.md).
Hồ sơ schema/lịch sử: [BACKUP-REPORTING.md](https://github.com/hunghvt-cyber/Homepage-nas/blob/main/docs/BACKUP-REPORTING.md).
Bản đồ quản trị: [0219nas-aio/SYSTEMS-20261019.md](https://github.com/hunghvt-cyber/0219nas-aio/blob/main/SYSTEMS-20261019.md).
