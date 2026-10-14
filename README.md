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

## Lịch chạy và an toàn

- Đồng bộ hằng ngày theo lịch GitHub Actions (xem [workflow](.github/workflows/bisync.yml)).
- Giới hạn tối đa **5 giờ** cho Rclone, dành thời gian còn lại để lưu cache và xuất báo cáo.
- Duy trì trạng thái Bisync giữa các lượt chạy; resync ban đầu chưa hoàn tất sẽ tiếp tục ở lượt sau.
- `--max-delete 25`, `--backup-dir2`, `--recover`, `--resilient`, `--checksum`.
- File không đồng bộ được sẽ được ghi nhận trong danh sách bỏ qua; không nên coi là đã backup.

## Xem báo cáo hằng ngày

Vào [Actions → Two-Way Sync](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/workflows/bisync.yml), mở lượt chạy mới nhất, xem **Summary** và tải artifact `bisync-report-<run_id>` để đọc `bisync.log` và danh sách file bỏ qua.
