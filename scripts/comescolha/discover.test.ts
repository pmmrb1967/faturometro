import { describe, expect, it } from 'vitest';
import { discoverCombined, discoverSearch, formPath, resultCount } from './discover';

// Minimal forms with the same markup as ANACOM's (titles, names, values).
const COMBINED = `
<form id="combinadosConsultaForm" method="post" action="/tarifarios/CombinadosResultadosConsulta.do;jsessionid=abc" class="formComb">
<input type="checkbox" name="idServico" value="1" id="internet" title="Internet" />
<input type="checkbox" name="idServico" value="2" id="televisao" title="Televis&atilde;o" />
<input type="checkbox" name="idServico" value="3" id="telefone" title="Telefone fixo" />
<input type="checkbox" name="idServico" value="4" id="movel" title="Serviços no telemóvel" />
<input type="checkbox" title="Checkbox" id="todos_1" name="todosPrestadores"/>
<input type="checkbox" name="todosPrestadores" value="on" id="todos_1" title="Todos" />
<input type="checkbox" title="NOS" id="left_1" name="idPrestadorLeft" value="972411" />
<input type="text" name="limiteMensal" maxlength="6" value="" title="Euros" />
<input type="checkbox" name="todasFidelizacoes" value="on" title="Todas fidelizações" />
<input type="checkbox" title="Sem fideliza&ccedil;&atilde;o" name="idFidelizacao" value="1"/>
<input type="text" name="codigoPostalPrefixo" maxlength="4" value="" title="Prefixo C&oacute;digo Postal" />
</form>`;

const MOBILE = `
<form id="movelConsultaForm" method="post" action="/tarifarios/MovelResultadosConsulta.do">
<input type="checkbox" name="todosPrestadores" value="on" title="Todos" />
<input type="checkbox" name="todosTiposTarifarios" value="on" title="Todos" />
<input type="text" name="limiteMensal" value="" title="Euros" />
</form>`;

describe('discover', () => {
  it('reads the results page without the session id', () => {
    expect(formPath(COMBINED)).toBe('CombinadosResultadosConsulta.do');
  });

  it('reads the combined search and its service checkboxes', () => {
    expect(discoverCombined(COMBINED)).toEqual({
      path: 'CombinadosResultadosConsulta.do',
      fixed: { todosPrestadores: 'on', todasFidelizacoes: 'on' },
      limitParam: 'limiteMensal',
      postalParam: 'codigoPostalPrefixo',
      serviceParam: 'idServico',
      serviceIds: { internet: '1', tv: '2', landline: '3', mobile: '4' },
    });
  });

  it('picks up renamed parameters and values by their labels', () => {
    const renamed = COMBINED.replace(/idServico/g, 'servico')
      .replace('value="3"', 'value="7"')
      .replace('limiteMensal', 'valorMaximo');
    expect(discoverCombined(renamed)).toMatchObject({
      serviceParam: 'servico',
      serviceIds: { landline: '7' },
      limitParam: 'valorMaximo',
    });
  });

  it('a search without postal code (mobile)', () => {
    expect(discoverSearch(MOBILE)).toEqual({
      path: 'MovelResultadosConsulta.do',
      fixed: { todosPrestadores: 'on', todosTiposTarifarios: 'on' },
      limitParam: 'limiteMensal',
    });
  });

  it('says what is missing when a label changes', () => {
    expect(discoverCombined(COMBINED.replace('title="Euros"', 'title="Valor"'))).toEqual({
      missing: ['monthly limit (Euros)'],
    });
    expect(discoverCombined(COMBINED.replace('title="Internet"', 'title="Net"'))).toEqual({
      missing: ['service internet'],
    });
  });

  it('counts results, and reads "no compatible offers" as zero', () => {
    expect(resultCount('<p>Foram encontrados 110 resultado(s)</p>')).toBe(110);
    expect(
      resultCount(
        '<strong>O COM.escolha n&atilde;o disponibiliza ofertas totalmente compat&iacute;veis com os requisitos</strong>',
      ),
    ).toBe(0);
    expect(resultCount('<p>Erro</p>')).toBeNull();
  });
});
