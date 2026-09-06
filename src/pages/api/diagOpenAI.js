import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";

// Temporary diagnostic - isolates the OpenAI/langchain call from every
// other step in fetchHeadlines (Storage read, Firestore cache check,
// Sleeper fetch) to determine whether the persistent ~60s timeout is
// actually the LLM call itself, or something upstream of it. Not wired
// into the app; hit directly for testing, then delete.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const start = Date.now();
  try {
    const model = new ChatOpenAI({
      temperature: 0.2,
      model: "gpt-4o-mini",
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    const prompt = PromptTemplate.fromTemplate("Say hello in exactly 3 words.");
    const chain = new LLMChain({ llm: model, prompt });
    const result = await chain.call({});
    return res.status(200).json({ ok: true, ms: Date.now() - start, text: result.text });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      ms: Date.now() - start,
      error: String(error?.message || error),
    });
  }
}
