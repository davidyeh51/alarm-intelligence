# 告警洞察平台
以 Supabase Auth 與受 RLS 保護的資料表呈現歷史告警快照，提供查詢、篩選、CSV 匯出及統計分析。

資料為原監控系統在匯入時可見的歷史告警快照，不會自動同步；統計為事件筆數，不代表故障時長或獨立事故數。新網站登入獨立於原網站。

以任意靜態 HTTP 伺服器或 GitHub Pages 發佈。前端只含 Supabase 可公開的 publishable key；讀取權限由登入及資料庫授權名單控制。請勿加入來源密碼、Supabase secret/service_role key 或告警資料檔。
