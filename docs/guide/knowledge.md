# Knowledge Base

The **Knowledge Base** provides a structured FAQ system for projects. It organizes question-answer pairs into categories, which can be selectively injected into conversations based on tags.

## Structure

### Knowledge Categories

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Category name (e.g., "Billing FAQ", "Product Features") |
| `promptTrigger` | Phrase that activates this category during classification |
| `tags` | Array of tags for filtering |
| `archived` | Whether the category is archived |
| `order` | Sort order for display |
| `version` | Optimistic locking version |

### Knowledge Items

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `categoryId` | Parent category |
| `question` | The question text |
| `answer` | The answer text |
| `order` | Sort order within the category |
| `version` | Optimistic locking version |

## How Knowledge Works

1. **Create categories** with descriptive `promptTrigger` phrases and `tags`
2. **Add items** (question-answer pairs) to each category
3. **Enable knowledge** on a stage by setting `useKnowledge: true`
4. **Filter by tags** using `knowledgeTags` on the stage to include only relevant categories

During classification, knowledge categories are injected as synthetic actions. When the classifier matches a knowledge category, the relevant FAQ items are included in the AI's response generation context, allowing it to answer directly from the knowledge base.

## Tags

Tags allow fine-grained control over which knowledge is available in each stage:

- A category tagged `["billing", "general"]` can be included when a stage sets `knowledgeTags: ["billing"]`
- If `knowledgeTags` is empty, **all** knowledge categories are considered
- Tags enable reusing the same knowledge across multiple stages with different subsets

## Example

**Category:** "Return Policy"
- **Prompt trigger:** "The user is asking about returns, refunds, or exchanges"
- **Tags:** `["support", "returns"]`

**Items:**
| Question | Answer |
|---|---|
| What is your return policy? | We accept returns within 30 days of purchase... |
| How do I get a refund? | To request a refund, visit your order page... |
| Can I exchange an item? | Yes, exchanges are available for items in stock... |

When the classifier detects the user asking about returns, it matches this category, and the AI uses the FAQ items to generate an accurate, consistent response.

## Organization Tips

- **Use specific prompt triggers** — Help the classifier accurately match user intent to the right category
- **Keep items focused** — Each item should cover one specific question
- **Use ordering** — Set `order` on categories and items for logical presentation
- **Tag strategically** — Use tags to control knowledge availability per stage without duplicating content
