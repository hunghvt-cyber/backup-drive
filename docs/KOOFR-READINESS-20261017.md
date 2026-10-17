# Đánh giá khả năng đưa Notes Koofr vào sử dụng — 17/10/2026

**Kết luận: chưa sẵn sàng thay backend production.** Prototype đủ cơ sở để tiếp tục kiểm chứng, chưa đủ cơ sở cam kết độ tin cậy hay trải nghiệm như Keep. Notes production tiếp tục dùng Vercel Blob. Báo cáo này chỉ đối chiếu mã nguồn và bằng chứng có sẵn; không chạy thêm benchmark, không triển khai hay chuyển dữ liệu thật.

Phạm vi chỉ là Notes/thư mục/workspace/chia sẻ trên Homepage hiện tại. Không thêm ứng dụng quản lý, không thay báo cáo NAS, GAS, chi tiêu/Gemini hay hai workflow backup hiện hữu.

## Bằng chứng đã có, và giới hạn của nó

- Homepage main đối chiếu: `a09b63b2c520312a70c8e13b645537f62fb7711a`; prototype trước đánh giá: `abb8e392d6f1d00b14d1ae5efb89fdeba9860876`.
- [Run 39002578699](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39002578699): 41 giai đoạn thực tế Vercel fra1 → Koofr đạt; tạo/đọc đủ 100 Notes giả, checklist, Unicode, thư mục, quyền chia sẻ/thu hồi, tranh chấp revision, fencing sau hết khóa, export/restore 104 bản ghi gồm 4 tombstone.
- [Run 39003147952](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39003147952): chỉ 2 Notes, kiểm tra bổ sung chặn thao tác khi restore chưa xong và chặn retry restore ghi đè chỉnh sửa mới. Không phải lần chạy lại toàn bộ 100 Notes. 43 kiểm thử mô phỏng đã đạt trước lượt đánh giá này.
- Lưu thực sự xuất bản revision: n=15, p50 2.093 ms, p95/max 5.296 ms. Mở Note: n=25, p50 447 ms. List: n=3, trộn phạm vi 25/26/100 Notes. Đây là thời gian phía server trong bài thử chức năng; chưa đo trên iPad, chưa phải benchmark đủ mẫu hay SLA. Con số 973 ms trước đây thuộc primitive khác.
- HTTP conditional PUT của Koofr từng không bảo vệ như CAS; độ an toàn đang dựa vào WebDAV LOCK và token kế thừa trên mọi PUT. Không được thay bằng đọc revision rồi ghi vô điều kiện.
- Đã từng lỗi inherited-lock khi dùng nhiều socket: PUT 412, cleanup 423. Một socket tuần tự riêng cho mỗi phiên đã vượt qua run 100 Notes. Chưa xác định nguyên nhân phía provider; chưa chứng minh an toàn khi thay socket giữa giao dịch hoặc nhiều invocation/instance độc lập.

Chi tiết và dữ liệu thô: [KOOFR-STORE100-20261017.md](KOOFR-STORE100-20261017.md), [summary](results/koofr-store100-summary-20261017.json), [raw gzip](results/koofr-store100-live-20261017.json.gz), [resilience](KOOFR-RESILIENCE-20261017.md). Các lỗi ban đầu được giữ nguyên làm bằng chứng.

## Các điểm chặn sử dụng thật

| Ưu tiên | Còn thiếu / ảnh hưởng | Điều kiện nghiệm thu đề xuất, chưa thực hiện |
| --- | --- | --- |
| P0 — an toàn ghi | Full store chưa được thử reconnect/crash/mất phản hồi và các HTTP invocation Vercel độc lập. Root lock còn tuần tự hóa cả đọc và ghi; 423 BUSY chưa có cơ chế client xử lý. | Ngắt tại LOCK, đọc catalog, ghi revision, publish, verify và UNLOCK; retry cùng op ID; cho khóa hết hạn; chạy từ các invocation riêng. Không lost update, double commit, ghi sau thu hồi hoặc xác nhận lưu sai; kết quả mơ hồ phải đối soát được. Giữ token fencing và maxSockets=1 cho đến khi chứng minh thay thế an toàn. |
| P0 — API và bảo mật | Route hiện tại là fixture GitHub OIDC, không phải API cho người dùng. Service mặc định `ownerContext` đáng tin cậy, không thể đưa thẳng ra HTTP. Chưa ghép session/Origin, public note/folder routes và secret vận hành lâu dài. | Adapter preview xác thực owner trên server, chống request trái nguồn, kiểm capability sống trước đọc/ghi/replay; chặn vượt scope/view→edit. Không lộ credential/token/nội dung trong cache, log, lỗi hoặc bundle. Thử trực tiếp HTTP bằng phiên không đăng nhập, link đã thu hồi và request giả. |
| P0 — tương thích dữ liệu | Chỉ 128 slot ID giả; giá trị Note tối đa 28.000 byte, đọc file khoảng 32 KB, catalog publish 240.000 byte; khác mức hiện tại 1 MB nội dung/3 MB bản ghi. Mỗi chỉnh sửa sinh file mới. | UUID thật, xử lý biên kích thước/Unicode/checklist/history và catalog gần đầy. Không cắt nội dung âm thầm; đọc được tất cả dữ liệu hợp lệ hiện tại trong bộ fixture tương đương, hoặc trình bày rõ thay đổi giới hạn trước quyết định sử dụng. |
| P0 — hợp đồng Homepage | List chỉ có 100 ký tự preview; chưa tìm toàn văn và checklist như frontend hiện tại. Chưa có `known`/delta, `notModified`, response save đầy đủ hay tích hợp các URL chia sẻ. Folder mới cần tạo rõ ràng, khác luồng nhập tên khi lưu hiện tại. | Bộ contract test owner/note share/folder workspace khớp UI hiện tại: tìm được từ ở cuối Note và checklist, tạo thư mục, pin/sort/history/delete/unfile, refresh không ghi đè bản đang nhập; không quay về snapshot toàn nội dung mỗi lần lưu. |
| P0 — bản nháp và retry | Frontend hiện giữ bản đang nhập chủ yếu trong bộ nhớ, cache localStorage chỉ là preview. Chưa có op ID ổn định xuyên retry, queue, xử lý 423/backoff và trạng thái kết quả ghi chưa rõ. | Lỗi mạng/đóng tab/tải lại trên iPad không làm mất bản nháp theo chính sách đã chọn; cùng mutation dùng cùng op ID và base revision. 409 giữ bản người dùng để đối chiếu; không tự ghi đè. Chỉ hiện “đã lưu” khi đã xác nhận commit. Việc lưu toàn nội dung trên thiết bị phải có thiết kế quyền riêng tư rõ ràng. |
| P0 — phục hồi và catalog | Catalog là điểm commit duy nhất; validator hiện còn nông. Backup cùng tài khoản/provider chưa bảo vệ khi mất tài khoản hoặc hỏng catalog. Export có tên cố định, chưa có vòng đời backup. | Validate sâu HEAD/path/hash/revision/ACL và từ chối dữ liệu sai; giữ nhiều thế hệ catalog+snapshot ngoài cùng kho. Phục hồi sang namespace mới từ backup độc lập, đối chiếu đủ bản ghi/tombstone, đổi epoch và thu hồi link; đo thời gian và mức dữ liệu có thể mất. Không tự dựng lại HEAD bằng “file mới nhất”. |
| P0 — vận hành | Metrics và bằng chứng hiện thuộc harness, chưa có log bền vững/giám sát cho người dùng thật, giới hạn dung lượng, cơ chế dọn revision/orphan hay triển khai tự động lâu dài. | Log cấu trúc có request reference, giai đoạn, latency, trạng thái commit/reconcile, BUSY/lease/cleanup; không body, ID/path riêng tư, raw token hay secret. Có retention, cảnh báo kiểm tra được, hướng xử lý hết dung lượng và kiểm tra backup thành công. |
| P0 — chuyển đổi/rollback | Chưa có adapter chọn backend cô lập, dry-run import/export/map ID/link và quy trình đối soát hai kho. | Preview chỉ dùng fixture, Blob vẫn mặc định. Trước cutover tương lai phải có so sánh số lượng/hash/quyền, backup kiểm chứng và kế hoạch xử lý bản nháp. Sau khi đã có ghi mới trên Koofr, không được chỉ bật lại Blob cũ vì sẽ mất các ghi mới; phải dừng ghi/đối soát trước. Mọi bước với dữ liệu thật hoặc production cần ủy quyền riêng. |

P0 nghĩa là phải giải quyết trước khi cho dữ liệu thật vào backend thay thế; không có nghĩa phải làm tất cả trước khi có UI preview dùng dữ liệu giả.

## Hai lỗ hổng phục hồi bổ sung qua đọc mã

Đây là phát hiện tĩnh trong `lib/store-backup.mjs`, chưa tái hiện trên Koofr thật hay bổ sung test trong lượt đánh giá này:

1. Snapshot rỗng: `initRestore` luôn đặt `restoring=true`, còn `restoreBatch` từ chối chunk không có phần tử. Với 0 bản ghi, chưa có đường hoàn tất restore. Cần test và xử lý trường hợp rỗng.
2. Khởi tạo restore chưa idempotent: `target.init()` đòi MKCOL trả 201. Nếu thư mục đã tạo rồi mất phản hồi/ghi catalog khởi tạo thất bại, gọi lại toàn bộ init không tự tiếp tục được. Các thử nghiệm retry chunk đã đạt không chứng minh khả năng tiếp tục ở giai đoạn khởi tạo này. Cần state machine khởi tạo có marker/schema và kiểm tra namespace để tiếp tục an toàn, tuyệt đối không ghi đè thư mục có sẵn không thuộc lượt restore.

GC chưa có. Cần chính sách retention có giới hạn và hành động khi gần đầy trước vận hành dài hạn. Có thể trì hoãn tự động xóa vật lý nếu tạm dùng giới hạn/cảnh báo và dọn có kiểm soát. GC sau này chỉ xóa khi chứng minh không còn HEAD/backup tham chiếu, qua thời gian an toàn và dưới khóa phù hợp; giữ tombstone để không hồi sinh Note đã xóa.

## Trình tự nên làm tiếp

1. **Kiểm chứng rủi ro cao nhất trước:** mở rộng thử lỗi trên full store với request Vercel độc lập và thay kết nối. Đề xuất ít nhất 50 cặp cạnh tranh cùng Note và khác Note; thử revoke/move/delete xen kẽ, op retry sau receipt eviction, hết khóa khi giao dịch chưa xong và process dừng trước/sau publish. Nếu có lost update, double commit hoặc stale writer publish thành công, dừng hướng chuyển Notes sang Koofr.
2. Nếu an toàn đạt: hoàn thiện adapter/security/contracts và bỏ giới hạn fixture; tạo UI preview dùng dữ liệu giả trên Homepage hiện tại. Không mở rộng thêm ứng dụng.
3. Đo tối thiểu 100 save và 100 get từ Vercel ở cấu hình dự định, tách cold/warm, 100 và 500 Notes, tải một người và đồng thời. Thu cả thất bại/423/retry và thời gian hoàn tất người dùng, không chỉ successful latency. Mốc thảo luận đề xuất: save p50 ≤3 s, p95 ≤8 s, timeout ≤1%; không coi các mốc này là đã đạt. Root lock phải có queue/backoff hữu hạn; không giấu thời gian chờ khỏi kết quả.
4. Thử iPad thực tế: mở, sửa liên tục, chuyển tab, reload, khóa màn hình, bật/tắt mạng, share/revoke giữa hai phiên; phục hồi bản nháp và sao lưu độc lập. Chỉ sau đó mới cân nhắc pilot dữ liệu thật, cần người dùng cho phép.

Có thể làm sau: đánh bóng giao diện, tối ưu số HTTP call hay GC tự động. Không bỏ bước readback/fencing để đạt tốc độ đẹp trước khi có bằng chứng thay thế tương đương. Không có cơ sở hẹn ngày đưa production vào dùng ở thời điểm này.

## Thiết lập một lần và tự quản lý

Các lần thử đã dùng kết nối Koofr có sẵn trong Actions, không cần người dùng nhập lại. Credential chỉ chuyển trong bộ nhớ qua request fixture được OIDC xác minh; đó chưa phải cấu hình lâu dài cho Notes chạy độc lập khi người dùng mở Homepage.

Adapter lâu dài cần credential phía server của project preview/production tương ứng, cơ chế cập nhật mã từ GitHub và log/backup tự động được giới hạn quyền. Chưa xác minh app password Koofr có thể giới hạn theo thư mục; không được mặc định credential backup hiện tại chỉ truy cập được thư mục Notes. Chỉ hướng dẫn cài credential một lần khi adapter cụ thể sẵn sàng, qua giao diện cấu hình an toàn; không yêu cầu mật khẩu/token trong chat. Thu hồi credential hoặc thay đổi chính sách tài khoản có thể vẫn cần chủ tài khoản can thiệp.

Fixture POST hiện tự hết hiệu lực **18/10/2026 03:00 UTC = 10:00 Việt Nam**, do giới hạn thử nghiệm chủ động trong code. Muốn chạy tiếp cần bản preview với cửa sổ thử mới có giới hạn; không tắt rào chắn này để biến fixture thành API người dùng. Lượt đánh giá này không gia hạn hay deploy lại.

**Quyết định hiện tại:** giữ production trên Blob; ưu tiên thử full-store reconnect/nhiều invocation trước khi đầu tư tích hợp UI. Tình trạng quota/khóa của private Notes Blob chưa được xác minh độc lập trong lượt đánh giá này, không dùng làm lý do bắt buộc chuyển kho.
