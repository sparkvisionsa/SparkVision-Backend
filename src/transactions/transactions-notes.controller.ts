import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { TransactionsNotesService } from "./transactions-notes.service";

@Controller("transactions")
export class TransactionsNotesController {
  constructor(private readonly svc: TransactionsNotesService) {}

  // GET /transactions/:id/notes
  @Get(":id/notes")
  listNotes(@Param("id") id: string) {
    return this.svc.listNotes(id);
  }

  // POST /transactions/:id/notes
  // JSON: { authorId, authorName, authorRole, authorColor, content, replyToId? }
  @Post(":id/notes")
  addNote(
    @Param("id") id: string,
    @Body()
    body: {
      authorId: string;
      authorName: string;
      authorRole: string;
      authorColor: string;
      content: string;
      replyToId?: string;
    },
  ) {
    return this.svc.addNote(id, body);
  }

  // PATCH /transactions/:id/notes/:noteId/pin
  @Patch(":id/notes/:noteId/pin")
  togglePin(@Param("id") id: string, @Param("noteId") noteId: string) {
    return this.svc.togglePin(id, noteId);
  }

  // PATCH /transactions/:id/notes/:noteId
  // JSON: { content: "..." }
  @Patch(":id/notes/:noteId")
  editNote(
    @Param("id") id: string,
    @Param("noteId") noteId: string,
    @Body("content") content: string,
  ) {
    return this.svc.editNote(id, noteId, content);
  }

  // DELETE /transactions/:id/notes/:noteId
  @Delete(":id/notes/:noteId")
  deleteNote(@Param("id") id: string, @Param("noteId") noteId: string) {
    return this.svc.deleteNote(id, noteId);
  }
}
