export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} 1st Tees. Sustainable bamboo golf tees, shipped to the UK and EU.</p>
        <p>1st Tees is a UK limited company, registered in England and Wales.</p>
      </div>
    </footer>
  );
}
