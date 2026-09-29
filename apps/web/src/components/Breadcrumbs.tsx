export interface Crumb {
  id: string | null;
  name: string;
}

export function Breadcrumbs({ path, onNavigate }: { path: Crumb[]; onNavigate: (index: number) => void }) {
  return (
    <div className="flex items-center gap-1 text-sm text-gray-600">
      {path.map((crumb, i) => (
        <span key={crumb.id ?? "root"} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">/</span>}
          <button
            onClick={() => onNavigate(i)}
            className={i === path.length - 1 ? "font-medium text-gray-900" : "hover:text-brand-600"}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </div>
  );
}
