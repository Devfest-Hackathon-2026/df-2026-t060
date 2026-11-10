// 質問として送ってよい項目だけにする(firestore.rules・relay/room-store.js の質問の条件と同じ)。
// 児童の画面は、aiTried / materialTitle / original に、使わないとき null や同じ文を入れてくることがある。それは送らない。
export function questionFields(q) {
  const out = { seat: q.seat, text: q.text };
  if (q.aiTried === true) out.aiTried = true;
  if (q.materialTitle) out.materialTitle = String(q.materialTitle).slice(0, 60);
  // AIが具体化する前の、児童のもとの言い方(具体化したときだけ)
  if (q.original && q.original !== q.text) out.original = String(q.original).slice(0, 200);
  if (q.inquiryContext != null) {
    if (typeof q.inquiryContext !== 'string' || q.inquiryContext.length > 40000) throw new Error('根拠データは40000字以内です');
    out.inquiryContext = q.inquiryContext;
  }
  return out;
}
