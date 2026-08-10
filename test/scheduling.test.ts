import { describe,expect,it } from "vitest";
import { assessScheduling,type SchedulingWindow } from "../src/scheduling";

const proposed: SchedulingWindow = { id: "new",startDate: "2027-06-10",endDate: "2027-06-10",startTime: "18:00",endTime: "22:00",blocksCapacity: false };
const event = (overrides: Partial<SchedulingWindow> = {}): SchedulingWindow => ({
  id: "existing",startDate: "2027-06-10",endDate: "2027-06-10",startTime: "17:00",endTime: "21:00",blocksCapacity: true,schedulingState: "confirmed",...overrides,
});

describe("scheduling assessment",() => {
  it("is clear with no conflicts",() => expect(assessScheduling(proposed,[],1).status).toBe("clear"));
  it("finds a same-day blocking conflict",() => expect(assessScheduling(proposed,[event()],1).status).toBe("capacity_conflict"));
  it("ignores a non-blocking lead",() => expect(assessScheduling(proposed,[event({ blocksCapacity: false })],1).status).toBe("clear"));
  it("finds overlapping multi-day events",() => {
    const result = assessScheduling({ ...proposed,startDate: "2027-06-11",endDate: "2027-06-13",startTime: null,endTime: null },[event({ startDate: "2027-06-12",endDate: "2027-06-14",startTime: null,endTime: null })],1);
    expect(result.status).toBe("capacity_conflict");
  });
  it("treats adjacent ranges as non-overlapping",() => expect(assessScheduling({ ...proposed,startDate: "2027-06-11",endDate: "2027-06-11" },[event({ endDate: "2027-06-10" })],1).status).toBe("clear"));
  it("honors capacity greater than one",() => expect(assessScheduling(proposed,[event()],2).status).toBe("clear"));
  it("requires review when no proposed date exists",() => expect(assessScheduling({ ...proposed,startDate: null },[],1).status).toBe("review_required"));
  it("reports potential conflict when times are incomplete",() => expect(assessScheduling(proposed,[event({ startTime: null,endTime: null })],1).status).toBe("potential_conflict"));
});
