import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CreateMessageRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

let todos: Todo[] = [];
let nextId = 1;

export function resetTodos() {
  todos = [];
  nextId = 1;
}

export async function setupTestServerAndClient() {
  // Create server instance
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
        sampling: {},
      },
      enforceStrictCapabilities: true,
    },
  );

  // Register tools with the server
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "add_todo",
          description: "Add a new todo item",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The text of the todo item",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "list_todos",
          description: "List all todo items",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "complete_todo",
          description: "Mark a todo item as completed",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The ID of the todo to complete",
              },
            },
            required: ["id"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params as {
      name: string;
      arguments: any;
    };

    switch (name) {
      case "add_todo": {
        const { text } = args as { text: string };
        const todo: Todo = {
          id: String(nextId++),
          text,
          completed: false,
        };
        todos.push(todo);
        return {
          content: [
            {
              type: "text",
              text: `Added todo: "${text}" with ID ${todo.id}`,
            },
          ],
        };
      }

      case "list_todos": {
        const todoList = todos
          .map(
            (todo) => `${todo.id}: ${todo.text} ${todo.completed ? "✓" : "○"}`,
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: todoList || "No todos found",
            },
          ],
        };
      }

      case "complete_todo": {
        const { id } = args as { id: string };
        const todo = todos.find((t) => t.id === id);
        if (!todo) {
          throw new Error(`Todo with ID ${id} not found`);
        }
        todo.completed = true;
        return {
          content: [
            {
              type: "text",
              text: `Completed todo: "${todo.text}"`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  // Create client instance
  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // Set up default request handler for sampling/createMessage
  client.setRequestHandler(CreateMessageRequestSchema, async () => {
    return {
      model: "test-model",
      role: "assistant",
      content: {
        type: "text",
        text: "This is a test response",
      },
    };
  });

  // Create transport pair and connect
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Return everything you need
  return {
    server,
    client,
    clientTransport,
    serverTransport,
    // Cleanup function
    async cleanup() {
      if (clientTransport) {
        await clientTransport.close?.();
      }
      if (serverTransport) {
        await serverTransport.close?.();
      }
    },
  };
}
