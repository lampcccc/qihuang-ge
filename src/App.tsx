import { Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ModuleBrowser } from "@/components/ModuleBrowser";
import { ResourceDetail } from "@/components/ResourceDetail";
import { Home } from "@/pages/Home";
import { Dictionary } from "@/pages/Dictionary";
import { Herbs } from "@/pages/Herbs";
import { HerbDetail } from "@/pages/HerbDetail";
import { Prescriptions } from "@/pages/Prescriptions";
import { PrescriptionDetail } from "@/pages/PrescriptionDetail";
import { WorksPage } from "@/pages/WorksPage";
import { BookDetail } from "@/pages/BookDetail";
import { Textbooks } from "@/pages/Textbooks";
import { Exam } from "@/pages/Exam";
import { Manual } from "@/pages/Manual";
import { Search } from "@/pages/Search";
import { NotFound } from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/herbs" element={<Herbs />} />
        {/* 药材详情：整页渲染（原右侧抽屉已移除） */}
        <Route path="/herbs/:id" element={<HerbDetail />} />
        {/* 汤方：中药材的子模块（列表 / 详情，含自建与编辑） */}
        <Route path="/prescriptions" element={<Prescriptions />} />
        <Route path="/prescriptions/:id" element={<PrescriptionDetail />} />
        <Route path="/dictionary" element={<Dictionary />} />
        <Route path="/dictionary/:id" element={<ResourceDetail module="dictionary" />} />
        <Route path="/works" element={<WorksPage />} />
        <Route path="/works/book/:typeId" element={<BookDetail />} />
        <Route path="/works/chapter/:id" element={<ResourceDetail module="works" />} />
        <Route
          path="/yian"
          element={
            <ModuleBrowser
              module="yian"
              title="医案心得"
              description="历代名医医案与临床诊疗心得。"
              placeholder="检索医案 / 病症…"
            />
          }
        />
        <Route path="/yian/:id" element={<ResourceDetail module="yian" />} />
        <Route
          path="/zaji"
          element={
            <ModuleBrowser
              module="zaji"
              title="杂集"
              description="中医相关的杂论、随笔与资料汇编。"
              placeholder="检索标题 / 关键词…"
            />
          }
        />
        <Route path="/zaji/:id" element={<ResourceDetail module="zaji" />} />
        <Route path="/textbooks" element={<Textbooks />} />
        <Route path="/exam" element={<Exam />} />
        <Route path="/manual" element={<Manual />} />
        <Route path="/search" element={<Search />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
