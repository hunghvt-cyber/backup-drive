# Ý tưởng Notes — triển khai sau khi vận hành ổn định

## Sắp xếp Note như launcher Android TV

Yêu cầu người dùng ngày 17/10/2026, chỉ ghi nhận ý tưởng; chưa triển khai.

Luồng mong muốn: bấm **Di chuyển Note** → chọn Note → dùng phím mũi tên để đổi vị trí trong lưới → kết thúc chế độ di chuyển. Cảm giác tương tự sắp xếp ứng dụng trên launcher Android TV.

Khi triển khai sau này cần chốt nút xác nhận/hủy, cách dùng trên iPad không có bàn phím, thứ tự riêng cho tất cả Notes hay từng thư mục, tương tác với Note ghim/tìm kiếm, lưu và đồng bộ thứ tự giữa thiết bị, xử lý hai người sắp xếp đồng thời. Đổi vị trí chỉ thay metadata thứ tự, không sửa nội dung Note. Chưa quyết định schema hoặc thay backend vì ý tưởng này.

Điều kiện bắt đầu: backend/đồng bộ/bản nháp/backup đã vận hành trơn tru. Không đưa việc này vào đợt kiểm thử độ tin cậy Koofr hiện tại.
