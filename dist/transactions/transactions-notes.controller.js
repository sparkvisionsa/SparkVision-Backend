"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsNotesController = void 0;
const common_1 = require("@nestjs/common");
const transactions_notes_service_1 = require("./transactions-notes.service");
let TransactionsNotesController = class TransactionsNotesController {
    constructor(svc) {
        this.svc = svc;
    }
    listNotes(id) {
        return this.svc.listNotes(id);
    }
    addNote(id, body) {
        return this.svc.addNote(id, body);
    }
    togglePin(id, noteId) {
        return this.svc.togglePin(id, noteId);
    }
    editNote(id, noteId, content) {
        return this.svc.editNote(id, noteId, content);
    }
    deleteNote(id, noteId) {
        return this.svc.deleteNote(id, noteId);
    }
};
exports.TransactionsNotesController = TransactionsNotesController;
__decorate([
    (0, common_1.Get)(":id/notes"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TransactionsNotesController.prototype, "listNotes", null);
__decorate([
    (0, common_1.Post)(":id/notes"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TransactionsNotesController.prototype, "addNote", null);
__decorate([
    (0, common_1.Patch)(":id/notes/:noteId/pin"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("noteId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TransactionsNotesController.prototype, "togglePin", null);
__decorate([
    (0, common_1.Patch)(":id/notes/:noteId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("noteId")),
    __param(2, (0, common_1.Body)("content")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], TransactionsNotesController.prototype, "editNote", null);
__decorate([
    (0, common_1.Delete)(":id/notes/:noteId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("noteId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TransactionsNotesController.prototype, "deleteNote", null);
exports.TransactionsNotesController = TransactionsNotesController = __decorate([
    (0, common_1.Controller)("transactions"),
    __metadata("design:paramtypes", [transactions_notes_service_1.TransactionsNotesService])
], TransactionsNotesController);
