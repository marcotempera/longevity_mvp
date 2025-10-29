export const MacroFlow = [
    "genetica_epigenetica_storiafamiliare",
    "dati_clinici_biochimici",
    "imaging_funzione",
    "segni_vitali_monitoraggio",
    "attivita_stile_vita",
    "nutrizione_idratazione",
    "sonno_ritmi",
    "funzioni_cognitive",
    "salute_mentale",
    "esposizioni_ambientali"
  ];
  
  export function getNextMacroarea(current) {
    const idx = MacroFlow.indexOf(current);
    return idx >= 0 && idx < MacroFlow.length - 1 ? MacroFlow[idx + 1] : null;
  }