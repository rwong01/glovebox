/**
 * Decides whether a lower odometer reading is worth asking about.
 *
 * Odometers only go up, so "this receipt shows fewer miles than the car has"
 * sounds alarming — but scanning a backlog means most receipts ARE older than
 * what is on file, and a lower reading on an older receipt is simply correct.
 * Prompting for those would mean a dialog on nearly every page of a stack.
 *
 * The reading is only suspicious when it is the newest thing we know about and
 * still went backwards. That needs a date to establish, so:
 *
 *   - no date on the page      -> no prompt. Cannot tell where it sits in the
 *                                 sequence, and nothing is overwritten either
 *                                 way, so silence is the safe answer.
 *   - older than the newest
 *     dated record on file     -> no prompt. Expected and correct.
 *   - newest, and lower        -> prompt. Either a misread digit, or the
 *                                 odometer on file is genuinely wrong.
 *
 * Nothing is written by this either way — the ratchet trigger never lowers the
 * odometer. This only decides whether to raise the question.
 */
export function detectMileageConflict({ serviceDate, mileage, newestOnFile, currentMileage }) {
  if (mileage == null) return null
  if (mileage >= currentMileage) return null // a ratchet up needs no comment
  if (!serviceDate) return null // undated page: no way to place it in sequence
  if (!newestOnFile?.service_date) return null // nothing dated to compare against

  // `>=` rather than `>`: a second receipt from the same day is still current.
  if (serviceDate < newestOnFile.service_date) return null

  return {
    extracted: mileage,
    current: currentMileage,
    comparedWith: {
      date: newestOnFile.service_date,
      mileage: newestOnFile.mileage_at_service,
    },
  }
}
