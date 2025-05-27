import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export function createTodoServer(): Server {
  const server = new Server(
    {
      name: "todo-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const todos: Todo[] = [];
  let nextId = 1;

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
                description: "The todo item text",
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
                description: "The todo item ID",
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

  return server;
}
