import { describe,expect,it } from "vitest";
import { buildInboxParams } from "./inbox-query";
import { monthRange } from "./schedule";
describe("staff view queries",()=>{
  it("builds bounded inbox filters for search and assigned-to-me",()=>{const result=buildInboxParams({query:" venue ",workflow:"new",assignment:"mine",currentResponderId:"rsp_a",offset:25});expect(result.get("query")).toBe("venue");expect(result.get("workflow")).toBe("new");expect(result.get("assignment")).toBe("rsp_a");expect(result.get("offset")).toBe("25");});
  it("builds a calendar month range without a calendar dependency",()=>{expect(monthRange(new Date(2027,1,12))).toMatchObject({start:"2027-02-01",end:"2027-02-28"});});
});
