import { ChatGroq } from "@langchain/groq"
import {
    StateGraph,
    MessagesAnnotation,
    END,
    MemorySaver,
} from "@langchain/langgraph"
import { ToolNode } from "@langchain/langgraph/prebuilt"
import {
    createGitRepository,
    deleteRepository,
    getRepository,
    gitPush,
    gitCloneRepository,
    getCommitsByRepoName,
    createOrUpdateGitFile,
    updateRepository,
} from "./tools.js"
import readline from "node:readline/promises"

const tools = [
    createGitRepository,
    deleteRepository,
    getRepository,
    gitPush,
    gitCloneRepository,
    getCommitsByRepoName,
    createOrUpdateGitFile,
    updateRepository,
]

// memory
const memory = new MemorySaver()

// Tool Node
const toolNode = new ToolNode(tools)

const llm = new ChatGroq({
    model: "openai/gpt-oss-120b",
    temperature: 0,
}).bindTools(tools)

// Assistant Node
async function callModel(state) {
    const response = await llm.invoke(state.messages)
    return { messages: [response] }
}

const shouldContinue = (state) => {
    const lastMessage = state.messages[state.messages.length - 1]

    if (lastMessage.tool_calls.length) {
        return "tools"
    }

    return "__end__"
}

const graph = new StateGraph(MessagesAnnotation)
    .addNode("assistant", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "assistant")
    .addEdge("tools", "assistant")
    .addConditionalEdges("assistant", shouldContinue, {
        __end__: END,
        tools: "tools",
    })

const agent = graph.compile({ checkpointer: memory })

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    while (true) {
        const query = await rl.question("User: ")

        if (query === "bye") {
            break
        }

        const response = await agent.invoke(
            {
                messages: [
                    {
                        role: "system",
                        content: `You are a smart github personal assistant to create and manage github repositories.`,
                    },
                    {
                        role: "user",
                        content: query,
                    },
                ],
            },
            {
                configurable: { thread_id: "1" },
            }
        )
        console.log(
            "AI: ",
            response.messages[response.messages.length - 1].content
        )
    }

    rl.close()
}

main()
