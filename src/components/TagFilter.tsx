/** Portal-backed searchable multi-tag filter using strict all-tag matching semantics. */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { TagOption } from "../lib/types";

export function TagFilter({ options, selected, onChange }: { options: TagOption[]; selected: string[]; onChange: (tags: string[]) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => options.filter((option) => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query]);
  const toggle = (name: string) => onChange(selected.some((tag) => tag.toLocaleLowerCase() === name.toLocaleLowerCase()) ? selected.filter((tag) => tag.toLocaleLowerCase() !== name.toLocaleLowerCase()) : [...selected, name]);
  return <div className="tag-filter-wrap">
    <DropdownMenu.Root onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenu.Trigger className={`button secondary${selected.length ? " active" : ""}`}>
        <Tags />标签{selected.length ? `（${selected.length}）` : ""}<ChevronDown />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="tag-menu filter-menu" align="start" sideOffset={6}>
          <div className="tag-filter-search" onKeyDown={(event) => event.stopPropagation()}><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索历史标签" aria-label="搜索历史标签" /></div>
          {filtered.length ? filtered.map((option) => {
            const checked = selected.some((tag) => tag.toLocaleLowerCase() === option.name.toLocaleLowerCase());
            return <DropdownMenu.CheckboxItem key={option.name} checked={checked} onSelect={(event) => event.preventDefault()} onCheckedChange={() => toggle(option.name)} className="tag-menu-item check-item"><span>{checked ? <Check /> : null}{option.name}</span><small>{option.usageCount} 个账号</small></DropdownMenu.CheckboxItem>;
          }) : <div className="tag-menu-empty">没有匹配的标签</div>}
          {selected.length > 0 && <><DropdownMenu.Separator className="menu-separator"/><button className="clear-menu" onClick={() => onChange([])}>清空全部标签</button></>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {selected.map((tag) => <button className="filter-chip" key={tag} onClick={() => toggle(tag)}>{tag}<X /></button>)}
  </div>;
}
