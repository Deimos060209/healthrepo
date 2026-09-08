# HealthRepo - Your Health. Your Right. Your Repo.

## Project Overview
A web app where users photograph packaged products to check Legal Metrology 
compliance and analyze ingredients for harmful substances. Built with Next.js, 
Supabase, Claude API, and Tesseract.js OCR. 
Website: healthrepo.vercel.app

## Tech Stack
- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Supabase (database, auth, storage)
- Claude API (ingredient analysis)
- Tesseract.js (OCR)
- jsPDF (PDF report generation)

## Commands
- npm run dev — start development server
- npm run build — production build
- npm run lint — run linter

## Key Architecture
- /app — pages (Next.js App Router)
- /components — reusable React components
- /lib — utility functions (Supabase client, Claude API, OCR)
- /types — TypeScript type definitions

## API Routes
- /api/analyze — sends extracted text to Claude API for analysis
- /api/report — generates PDF report data

## Important Notes
- All API keys are in .env.local (never commit this file)
- Claude API calls happen server-side only (API routes)
- OCR (Tesseract.js) runs client-side in the browser
- Supabase handles auth, database, and image storage
