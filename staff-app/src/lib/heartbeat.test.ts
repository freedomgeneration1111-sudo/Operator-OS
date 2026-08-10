import { afterEach,describe,expect,it,vi } from "vitest";
import { HeartbeatController,type HeartbeatState } from "./heartbeat";
afterEach(()=>vi.useRealTimers());
describe("HeartbeatController",()=>{
  it("starts immediately and derives a one-third timeout interval",async()=>{vi.useFakeTimers();const send=vi.fn(async()=>{});const states:HeartbeatState[]=[];const controller=new HeartbeatController(send,(state)=>states.push(state));await controller.start(120);expect(send).toHaveBeenCalledWith(true);await vi.advanceTimersByTimeAsync(40_000);expect(send).toHaveBeenCalledTimes(2);expect(states).toContain("live");await controller.stop(false);});
  it("does not leak duplicate intervals",async()=>{vi.useFakeTimers();const send=vi.fn(async()=>{});const controller=new HeartbeatController(send,()=>{});await Promise.all([controller.start(120),controller.start(120)]);await vi.advanceTimersByTimeAsync(40_000);expect(send).toHaveBeenCalledTimes(2);await controller.stop(false);});
  it("sends explicit unavailable and stops future heartbeats",async()=>{vi.useFakeTimers();const send=vi.fn(async()=>{});const controller=new HeartbeatController(send,()=>{});await controller.start(120);await controller.stop(true);expect(send).toHaveBeenLastCalledWith(false);await vi.advanceTimersByTimeAsync(120_000);expect(send).toHaveBeenCalledTimes(2);});
  it("shows degraded state when a heartbeat fails",async()=>{const states:HeartbeatState[]=[];const controller=new HeartbeatController(async()=>{throw new Error("offline");},(state)=>states.push(state));await controller.start(120);expect(states).toContain("degraded");await controller.stop(false);});
});
