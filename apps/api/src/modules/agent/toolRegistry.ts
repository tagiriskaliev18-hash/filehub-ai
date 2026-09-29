import type Anthropic from "@anthropic-ai/sdk";
import * as docxTools from "./tools/docx.js";
import * as pptxTools from "./tools/pptx.js";
import * as xlsxTools from "./tools/xlsx.js";
import * as pdfTools from "./tools/pdf.js";

export type DocCategory = "docx" | "pptx" | "xlsx" | "pdf" | "unsupported";

export function categoryForFile(mimeType: string): DocCategory {
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (mimeType === "application/pdf") return "pdf";
  return "unsupported";
}

// One entry per file attached to the conversation — a chat can now have
// several files open at once (e.g. comparing a spec against a delivered
// project), so tool calls address a specific file by fileId rather than
// implicitly operating on "the" file the way a single-file session used to.
export interface AttachedFileState {
  fileId: string;
  name: string;
  category: DocCategory;
  buffer: Buffer;
  changeLog: string[];
  proposedSummary: string | null;
  // undefined = not checked yet. Gates propose_diff (and, for pdf, the
  // create_file_from_description path that stands in for editing) for THIS
  // file specifically — see CHECK_SIGNATURES_TOOL below. Deliberately
  // code-enforced rather than left to the system prompt alone: a long
  // enough conversation can talk a model into reinterpreting a soft
  // instruction, but it can't talk its way past a tool call that was never
  // made.
  documentHasSignatures?: boolean;
}

export interface AgentToolContext {
  files: Map<string, AttachedFileState>;
}

function requireFile(ctx: AgentToolContext, fileId: string | undefined): AttachedFileState {
  if (!fileId) throw new Error("Не указан fileId — сначала вызови list_attached_files, чтобы узнать id нужного файла.");
  const f = ctx.files.get(fileId);
  if (!f) throw new Error(`Файл с id "${fileId}" не прикреплён к этой беседе. Вызови list_attached_files, чтобы увидеть доступные файлы.`);
  return f;
}

const FILE_ID_PARAM = { fileId: { type: "string", description: "id файла из list_attached_files, к которому применить действие" } };

export const LIST_ATTACHED_FILES_TOOL: Anthropic.Tool = {
  name: "list_attached_files",
  description: "Возвращает список всех файлов, прикреплённых к этой беседе (id, имя, тип). Вызывай это первым, если в беседе больше одного файла или ты не уверен в id нужного файла.",
  input_schema: { type: "object", properties: {} },
};

const DOCX_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_docx_text",
    description: "Читает весь текст документа Word построчно (по абзацам). Используй перед редактированием, чтобы увидеть текущее содержимое.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM }, required: ["fileId"] },
  },
  {
    name: "replace_text",
    description: "Заменяет все вхождения текста find на replace во всём документе. Работает даже если фраза разбита между несколькими текстовыми run-ами Word.",
    input_schema: {
      type: "object",
      properties: {
        ...FILE_ID_PARAM,
        find: { type: "string", description: "Точный текст, который нужно найти" },
        replace: { type: "string", description: "Текст для замены" },
      },
      required: ["fileId", "find", "replace"],
    },
  },
  {
    name: "append_paragraph",
    description: "Добавляет новый абзац в конец документа.",
    input_schema: {
      type: "object",
      properties: {
        ...FILE_ID_PARAM,
        text: { type: "string" },
        heading: { type: "boolean", description: "true — оформить как заголовок 1-го уровня" },
      },
      required: ["fileId", "text"],
    },
  },
];

const PPTX_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_slides",
    description: "Возвращает список слайдов презентации с их индексом, заголовком и текстом.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM }, required: ["fileId"] },
  },
  {
    name: "edit_slide_text",
    description: "Заменяет текст find на replace на конкретном слайде (по индексу, начиная с 0).",
    input_schema: {
      type: "object",
      properties: { ...FILE_ID_PARAM, slideIndex: { type: "integer" }, find: { type: "string" }, replace: { type: "string" } },
      required: ["fileId", "slideIndex", "find", "replace"],
    },
  },
  {
    name: "set_slide_content",
    description: "Полностью задаёт заголовок и/или основной текст указанного слайда.",
    input_schema: {
      type: "object",
      properties: { ...FILE_ID_PARAM, slideIndex: { type: "integer" }, title: { type: "string" }, body: { type: "string" } },
      required: ["fileId", "slideIndex"],
    },
  },
  {
    name: "add_slide",
    description: "Добавляет новый слайд после указанного индекса, используя оформление последнего слайда как основу.",
    input_schema: {
      type: "object",
      properties: { ...FILE_ID_PARAM, afterIndex: { type: "integer" }, title: { type: "string" }, body: { type: "string" } },
      required: ["fileId", "afterIndex", "title", "body"],
    },
  },
  {
    name: "remove_slide",
    description: "Удаляет слайд по индексу.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM, slideIndex: { type: "integer" } }, required: ["fileId", "slideIndex"] },
  },
  {
    name: "reorder_slides",
    description: "Перемещает слайд с fromIndex на позицию toIndex.",
    input_schema: {
      type: "object",
      properties: { ...FILE_ID_PARAM, fromIndex: { type: "integer" }, toIndex: { type: "integer" } },
      required: ["fileId", "fromIndex", "toIndex"],
    },
  },
];

const XLSX_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_sheet_names",
    description: "Возвращает список названий листов книги.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM }, required: ["fileId"] },
  },
  {
    name: "read_sheet",
    description: "Читает содержимое листа (ячейки и формулы) в текстовом виде.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM, sheetName: { type: "string" } }, required: ["fileId"] },
  },
  {
    name: "set_cell",
    description: "Устанавливает значение ячейки.",
    input_schema: {
      type: "object",
      properties: {
        ...FILE_ID_PARAM,
        sheetName: { type: "string" },
        cellRef: { type: "string", description: "Например, B2" },
        value: { type: ["string", "number"] },
      },
      required: ["fileId", "cellRef", "value"],
    },
  },
  {
    name: "set_formula",
    description: "Устанавливает формулу в ячейку (например, =SUM(A1:A10)).",
    input_schema: {
      type: "object",
      properties: { ...FILE_ID_PARAM, sheetName: { type: "string" }, cellRef: { type: "string" }, formula: { type: "string" } },
      required: ["fileId", "cellRef", "formula"],
    },
  },
  {
    name: "add_sheet",
    description: "Добавляет новый пустой лист с указанным названием.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM, name: { type: "string" } }, required: ["fileId", "name"] },
  },
];

const PDF_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_pdf_text",
    description:
      "Извлекает текстовый слой PDF-файла для чтения, суммаризации, перевода, сравнения с другими прикреплёнными файлами или ответов на вопросы. Если текстового слоя нет (скан), автоматически возвращает страницы как изображения — прочитай текст и опиши содержимое (включая рисунки/фото) прямо по ним, распознавание уже встроено. PDF нельзя редактировать напрямую — для создания нового файла на основе содержимого используй create_file_from_description.",
    input_schema: { type: "object", properties: { ...FILE_ID_PARAM }, required: ["fileId"] },
  },
];

export const CHECK_SIGNATURES_TOOL: Anthropic.Tool = {
  name: "check_document_signatures",
  description:
    "ОБЯЗАТЕЛЬНО вызови этот инструмент для конкретного файла ПЕРЕД первым редактированием этого файла (до propose_diff или, для PDF, до create_file_from_description как замены редактирования) — но не раньше, чем прочитаешь его содержимое. Честно сообщи, увидел ли ты в документе подписи, печати/штампы, формулировки вида «утверждаю»/«согласовано» с указанием конкретных лиц, либо иные признаки того, что документ уже утверждён/подписан реальными людьми. Пока этот инструмент не вызван для файла (или если он вернул true), редактирование и создание исправленной версии ЭТОГО файла заблокированы — это техническое ограничение платформы, а не то, что можно обойти повторным вызовом с другим ответом.",
  input_schema: {
    type: "object",
    properties: {
      ...FILE_ID_PARAM,
      hasSignatures: {
        type: "boolean",
        description: "true — документ содержит подписи/печати/явные признаки утверждения конкретными людьми; false — документ этого не содержит (черновик/шаблон без подписей)",
      },
      reasoning: { type: "string", description: "Коротко, что именно увидел (или не увидел) в подтверждение ответа" },
    },
    required: ["fileId", "hasSignatures", "reasoning"],
  },
};

export const PROPOSE_DIFF_TOOL: Anthropic.Tool = {
  name: "propose_diff",
  description:
    "Завершает редактирование КОНКРЕТНОГО файла и показывает пользователю предпросмотр изменений перед сохранением. Вызывай не больше одного раза за сообщение (если нужно отредактировать несколько файлов, делай это по одному за раз, в следующих сообщениях), когда все нужные правки в этот файл внесены инструментами выше. Обязательно опиши, что именно изменилось.",
  input_schema: {
    type: "object",
    properties: { ...FILE_ID_PARAM, summary: { type: "string", description: "Краткое описание внесённых изменений на русском языке" } },
    required: ["fileId", "summary"],
  },
};

export const CREATE_FILE_TOOL: Anthropic.Tool = {
  name: "create_file_from_description",
  description:
    "Создаёт совершенно новый файл (docx, pptx или xlsx) с нуля по текстовому описанию/структуре, не изменяя напрямую никакой существующий файл. Используй, когда пользователь просит создать новый документ/презентацию/таблицу, ИЛИ (для PDF/сканов) как единственный способ получить исправленную версию — в этом случае укажи sourceFileId, чтобы применились те же правила проверки подписей, что и для обычного редактирования.",
  input_schema: {
    type: "object",
    properties: {
      fileType: { type: "string", enum: ["docx", "pptx", "xlsx"] },
      fileName: { type: "string", description: "Имя файла без пути, с расширением" },
      sourceFileId: {
        type: "string",
        description: "Заполняй, только если это исправленная версия конкретного прикреплённого PDF/скана (см. описание выше) — тогда сработает та же проверка подписей, что и для propose_diff.",
      },
      docx: {
        type: "object",
        description: "Заполняй только если fileType=docx",
        properties: {
          title: { type: "string" },
          sections: {
            type: "array",
            items: { type: "object", properties: { heading: { type: "string" }, text: { type: "string" } }, required: ["text"] },
          },
        },
      },
      pptx: {
        type: "object",
        description: "Заполняй только если fileType=pptx",
        properties: {
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, bullets: { type: "array", items: { type: "string" } } },
              required: ["title"],
            },
          },
        },
      },
      xlsx: {
        type: "object",
        description: "Заполняй только если fileType=xlsx",
        properties: {
          sheetName: { type: "string" },
          rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
        },
      },
    },
    required: ["fileType", "fileName"],
  },
};

// Tool list is the union of every attached file's category-specific tools
// (each already scoped by an explicit fileId param above), plus the
// universal ones — so a chat with a docx and an xlsx attached gets both
// sets of tools, one shared model call either way.
export function getToolsForCategories(categories: Set<DocCategory>): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [LIST_ATTACHED_FILES_TOOL, CHECK_SIGNATURES_TOOL, CREATE_FILE_TOOL];
  if (categories.has("docx")) tools.push(...DOCX_TOOLS, PROPOSE_DIFF_TOOL);
  if (categories.has("pptx")) tools.push(...PPTX_TOOLS);
  if (categories.has("xlsx")) tools.push(...XLSX_TOOLS);
  if (categories.has("pdf")) tools.push(...PDF_TOOLS);
  // PROPOSE_DIFF_TOOL is only pushed once even if multiple editable
  // categories are present, since pptx/xlsx share it with docx.
  if ((categories.has("pptx") || categories.has("xlsx")) && !categories.has("docx")) tools.push(PROPOSE_DIFF_TOOL);
  return tools;
}

export type ToolResultContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export async function dispatchTool(name: string, input: any, ctx: AgentToolContext): Promise<ToolResultContent> {
  if (name === "list_attached_files") {
    return JSON.stringify(
      [...ctx.files.values()].map((f) => ({ fileId: f.fileId, name: f.name, type: f.category })),
      null,
      2,
    );
  }

  if (name === "check_document_signatures") {
    const f = requireFile(ctx, input.fileId);
    f.documentHasSignatures = !!input.hasSignatures;
    return f.documentHasSignatures
      ? `Зафиксировано для "${f.name}": документ содержит подписи/утверждение конкретными лицами. Редактирование и создание исправленной версии заблокированы.`
      : `Зафиксировано для "${f.name}": подписей/утверждения не обнаружено. Редактирование разрешено.`;
  }

  if (name === "propose_diff") {
    const f = requireFile(ctx, input.fileId);
    if (f.documentHasSignatures !== false) {
      throw new Error(
        f.documentHasSignatures === true
          ? `Редактирование "${f.name}" заблокировано: в документе обнаружены подписи/утверждение конкретными лицами. Изменение содержимого уже подписанного документа не выполняется — используйте официальный порядок исправления (переподписание или протокол об исправлении ошибки).`
          : `Сначала вызови check_document_signatures для "${f.name}", чтобы проверить документ на наличие подписей — без этого редактирование недоступно.`,
      );
    }
    f.proposedSummary = input.summary;
    return `Изменения для "${f.name}" подготовлены и показаны пользователю для подтверждения.`;
  }

  const category = ctx.files.get(input.fileId)?.category;

  if (category === "docx") {
    const f = requireFile(ctx, input.fileId);
    switch (name) {
      case "read_docx_text":
        return docxTools.readDocxText(f.buffer);
      case "replace_text": {
        const r = await docxTools.replaceDocxText(f.buffer, input.find, input.replace);
        f.buffer = r.buffer;
        f.changeLog.push(`Заменено "${input.find}" → "${input.replace}" (${r.occurrences} вхождений)`);
        return r.occurrences > 0 ? `Заменено вхождений: ${r.occurrences}` : "Текст не найден, замена не выполнена";
      }
      case "append_paragraph":
        f.buffer = await docxTools.appendDocxParagraph(f.buffer, input.text, input.heading);
        f.changeLog.push(`Добавлен абзац: "${input.text.slice(0, 60)}"`);
        return "Абзац добавлен";
    }
  }

  if (category === "pptx") {
    const f = requireFile(ctx, input.fileId);
    switch (name) {
      case "list_slides":
        return JSON.stringify(await pptxTools.listSlides(f.buffer), null, 2);
      case "edit_slide_text": {
        const r = await pptxTools.editSlideText(f.buffer, input.slideIndex, input.find, input.replace);
        f.buffer = r.buffer;
        f.changeLog.push(`Слайд ${input.slideIndex + 1}: "${input.find}" → "${input.replace}"`);
        return r.occurrences > 0 ? `Заменено вхождений: ${r.occurrences}` : "Текст не найден на слайде";
      }
      case "set_slide_content":
        f.buffer = await pptxTools.setSlideTitleAndBody(f.buffer, input.slideIndex, input.title, input.body);
        f.changeLog.push(`Слайд ${input.slideIndex + 1}: обновлено содержимое`);
        return "Содержимое слайда обновлено";
      case "add_slide":
        f.buffer = await pptxTools.addSlide(f.buffer, input.afterIndex, input.title, input.body);
        f.changeLog.push(`Добавлен новый слайд после слайда ${input.afterIndex + 1}: "${input.title}"`);
        return "Слайд добавлен";
      case "remove_slide":
        f.buffer = await pptxTools.removeSlide(f.buffer, input.slideIndex);
        f.changeLog.push(`Удалён слайд ${input.slideIndex + 1}`);
        return "Слайд удалён";
      case "reorder_slides":
        f.buffer = await pptxTools.reorderSlides(f.buffer, input.fromIndex, input.toIndex);
        f.changeLog.push(`Слайд перемещён с позиции ${input.fromIndex + 1} на ${input.toIndex + 1}`);
        return "Порядок слайдов изменён";
    }
  }

  if (category === "pdf") {
    const f = requireFile(ctx, input.fileId);
    switch (name) {
      case "read_pdf_text": {
        const text = await pdfTools.readPdfText(f.buffer);
        if (!text.startsWith("(в PDF не найден текстовый слой")) return text;

        const { images, totalPages } = await pdfTools.renderPdfPagesAsImages(f.buffer);
        if (images.length === 0) return text;
        const note =
          images.length < totalPages
            ? `Текстового слоя нет (скан). Показаны первые ${images.length} из ${totalPages} страниц как изображения — прочитай их напрямую.`
            : `Текстового слоя нет (скан). Все ${totalPages} страниц(-а) показаны как изображения — прочитай их напрямую.`;
        return [
          { type: "text", text: note },
          ...images.map(
            (img): Anthropic.ImageBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.base64 },
            }),
          ),
        ];
      }
    }
  }

  if (category === "xlsx") {
    const f = requireFile(ctx, input.fileId);
    switch (name) {
      case "list_sheet_names":
        return (await xlsxTools.listSheetNames(f.buffer)).join(", ");
      case "read_sheet":
        return xlsxTools.readSheet(f.buffer, input.sheetName);
      case "set_cell":
        f.buffer = await xlsxTools.setCell(f.buffer, input.sheetName, input.cellRef, input.value);
        f.changeLog.push(`Ячейка ${input.cellRef} = ${input.value}`);
        return "Ячейка обновлена";
      case "set_formula":
        f.buffer = await xlsxTools.setFormula(f.buffer, input.sheetName, input.cellRef, input.formula);
        f.changeLog.push(`Ячейка ${input.cellRef} = ${input.formula}`);
        return "Формула установлена";
      case "add_sheet":
        f.buffer = await xlsxTools.addSheet(f.buffer, input.name);
        f.changeLog.push(`Добавлен лист "${input.name}"`);
        return "Лист добавлен";
    }
  }

  throw new Error(`Неизвестный инструмент "${name}" для файла с id "${input.fileId ?? "?"}"`);
}
