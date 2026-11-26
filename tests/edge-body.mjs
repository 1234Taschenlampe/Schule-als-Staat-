import assert from "node:assert/strict";
import test from "node:test";
import {boundedText} from "../supabase/functions/_shared/body.js";
function request(chunks){
  const stream = new ReadableStream({start(controller){
    for(const part of chunks)controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  }});
  return new Request("https://example.invalid",{method:"POST",body:stream,duplex:"half"});
}
test("edge functions limit streamed request bytes across chunk boundaries",async()=>{
  assert.equal(await boundedText(request(["ü","ab"]),4),"üab");
  assert.equal(await boundedText(request(["ü","ab"]),3),null);
});
