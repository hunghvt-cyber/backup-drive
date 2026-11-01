# Google Drive → Koofr Backup

Chủ hệ thống chọn **Drive là nguồn chuẩn; Koofr chỉ nhận bản sao** ngày 01/11/2026. Mã hiện hành dùng `rclone copy`, không còn bisync hai chiều. Trạng thái chạy thật phải đọc từ [Actions](https://github.com/hunghvt-cyber/backup-drive/actions/workflows/bisync.yml), không suy từ commit hoặc CI.

## Chính sách dữ liệu

- Chỉ đọc `gdrive:` và ghi `koofr:GoogleBackup`; không ghi/xóa ngược về Drive.
- File chỉ có ở Koofr được **giữ lại**. Đây là backup một chiều giữ bản dư, không phải mirror có xóa đích.
- Khi file cùng đường dẫn trên Drive thay đổi, bản Koofr cũ được giữ tại `koofr:GoogleBackup-Versions/<run_id>-<attempt>/...` trước khi thay thế. Không có lịch tự xóa các phiên bản này.
- Giữ nguyên bộ lọc `Tapo-Archive/` và danh sách file bỏ qua đã có. File bị bỏ qua không được coi là đã backup.
- Dùng checksum khi có; metadata/checksum không có không chứng minh nội dung giống nhau. Các file trùng trên nguồn vẫn cần kiểm tra riêng; không tự dedupe.
- Không cần baseline bisync, resync, reset hoặc khóa bisync. Cache/log lịch sử được giữ nguyên để điều tra; không dùng chúng để suy diễn thao tác xóa.

## Vận hành

Workflow giữ đường dẫn `.github/workflows/bisync.yml` để tương thích báo cáo, nhưng tên hiển thị là **Google Drive to Koofr Backup**. Lịch vẫn `0 19 * * *` UTC, dự kiến **02:00 Việt Nam**; GitHub có thể chạy trễ. Giữ 35 phút/job, 29 phút cho mỗi lượt rclone cộng dự phòng dừng/lưu báo cáo. Copy có thể chạy lại mà không cần dựng baseline; quá thời gian được báo `paused`, workflow không được coi là đã hoàn tất backup.

`Run workflow` có một tùy chọn `dry_run`: mặc định bật để chỉ xem thử; tắt khi muốn chạy backup thật. Preview không phát báo cáo backup lên GAS. Trong đợt chuyển đổi, một push thay đổi hồ sơ `deploy/drive-copy-cutover-20261101.json` chạy preview trước; chỉ khi preview hoàn tất mới cho phép job copy thật. Đây không phải cron mới.

Báo cáo nhỏ, không có tên file, tiếp tục đi Actions → GAS/Drive → Homepage qua cùng source `gdrive-koofr`. Trạng thái truyền dữ liệu và phát báo cáo được kiểm tra riêng. Artifact mới chỉ có aggregate, lưu 7 ngày; raw log/danh sách đường dẫn không đưa lên artifact công khai. Ignored list có cache riêng nhỏ; không lưu thêm bisync state.

## Tiếp quản

- [Chính sách và bằng chứng chuyển một chiều](docs/DRIVE-SOURCE-COPY-20261101.md).
- [Sự cố checkpoint bisync trước chuyển đổi](docs/BISYNC-STATE-RECOVERY-20261101.md).
- [Báo cáo GAS](docs/REPORTS-GAS.md), [khôi phục đường báo cáo theo tên repo](docs/BACKUP-REPORT-RECOVERY-20261029.md).
- [Homepage](https://github.com/hunghvt-cyber/web-home), [NAS AIO](https://github.com/hunghvt-cyber/0219nas-aio).

Bằng chứng bisync cũ (ví dụ [14/10](https://github.com/hunghvt-cyber/backup-drive/actions/runs/38482597215)) là lịch sử. Không bật lại luồng ghi hai chiều từ hướng dẫn cũ.
