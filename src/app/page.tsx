import { Header } from "@/components/layout/Header";
import { Hero } from "@/components/sections/Hero";
import { Services } from "@/components/sections/Services";
import { Methodology } from "@/components/sections/Methodology";
import { Metrics } from "@/components/sections/Metrics";
import { Trust } from "@/components/sections/Trust";
import { FAQ } from "@/components/sections/FAQ";
import { CTA } from "@/components/sections/CTA";
import { Footer } from "@/components/layout/Footer";
import { ChatWidget } from "@/components/sections/ChatWidget";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex flex-col min-h-screen">
        <Hero />
        <ChatWidget />
        <Services />
        <Methodology />
        <Metrics />
        <Trust />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
